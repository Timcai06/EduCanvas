import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  gatewayNodeInvocationRequestSchema,
  gatewayNodePairingRecordSchema,
  type GatewayCapabilityManifest,
  type GatewayNodeInvocationRequest,
} from '@educanvas/gateway-core';
import { SafeNodeHostExecutor } from '@educanvas/node-host';
import { z } from 'zod';

/**
 * 当前 Node 节点可以宣告的能力清单。
 * 仅向上报能力，不直接代表网关是否批准；最终运行时能力以 pairing.approvedCapabilities 为准。
 */
const capabilities: GatewayCapabilityManifest = {
  manifestId: 'node-host:v1',
  issuedAt: new Date(0).toISOString(),
  capabilities: [
    { name: 'device.status', risk: 'l0', version: '1', constraints: {} },
    {
      name: 'filesystem.read_allowlisted',
      risk: 'l1',
      version: '1',
      constraints: { writes: false, shell: false },
    },
  ],
};

const configSchema = z
  .object({
    /** 网关服务地址（必须是绝对 HTTPS/HTTP URL）。 */
    gatewayUrl: z.string().url(),
    /** 设备所属用户标识。 */
    userId: z.string().min(1),
    /** 网关分配的 nodeId（pair 成功后写入）。 */
    nodeId: z.string().min(1),
    /** 运行时会话令牌（由网关颁发，具备短生命周期）。 */
    token: z.string().min(32),
    /** 配置过期时间，采用 RFC3339 格式，用于本地判断失效边界。 */
    expiresAt: z.string().datetime({ offset: true }),
    /** ed25519 私钥 PEM，用于签名相关能力证明。 */
    privateKey: z.string().min(32),
    /** 网关端 pairing 回写的完整记录。 */
    pairing: gatewayNodePairingRecordSchema,
  })
  .strict();

/** 返回本地持久化配置文件路径，默认落在用户主目录安全目录。 */
function configPath(): string {
  return path.join(os.homedir(), '.config', 'educanvas', 'node.json');
}

/**
 * 持久化节点配置：目录 0o700、文件 0o600，避免配置中 token/privateKey 泄漏。
 */
async function saveConfig(value: z.infer<typeof configSchema>): Promise<void> {
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(file, 0o600);
}

/**
 * 从本地配置读取并完整校验，任何字段不合法会抛出校验错误中断启动。
 */
async function loadConfig() {
  return configSchema.parse(JSON.parse(await readFile(configPath(), 'utf8')));
}

/**
 * 发起带授权头的网关 JSON 请求；失败时走统一失败关闭路径（不吞掉鉴权错误细节）。
 */
async function requestJson(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    response.body?.cancel().catch(() => undefined);
    throw new Error(`Gateway Node request failed with HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * 执行首次配对：
 * - 校验参数和 bootstrap token
 * - 生成一次性密钥对
 * - 向网关提交 pairing request
 * - 将颁发的 token 与配对记录写入本地安全配置
 */
async function pair(args: readonly string[]): Promise<void> {
  const [gatewayUrl, userId, displayName = os.hostname()] = args;
  const bootstrapToken = process.env.EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN;
  if (!gatewayUrl || !userId || !bootstrapToken) {
    throw new Error('pair requires gateway URL, user ID and bootstrap token');
  }
  const keys = generateKeyPairSync('ed25519');
  const now = new Date();
  const issuedCapabilities = { ...capabilities, issuedAt: now.toISOString() };
  const body = await requestJson(
    `${gatewayUrl.replace(/\/$/, '')}/v1/node/pair`,
    bootstrapToken,
    {
      method: 'POST',
      body: JSON.stringify({
        userId,
        request: {
          pairingRequestId: randomUUID(),
          displayName,
          devicePublicKey: keys.publicKey
            .export({ type: 'spki', format: 'pem' })
            .toString(),
          nonce: randomUUID(),
          requestedCapabilities: issuedCapabilities,
          requestedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
        },
      }),
    },
  );
  const parsed = z
    .object({
      pairing: gatewayNodePairingRecordSchema,
      token: z.string().min(32),
      expiresAt: z.string().datetime({ offset: true }),
    })
    .strict()
    .parse(body);
  await saveConfig({
    gatewayUrl,
    userId,
    nodeId: parsed.pairing.nodeId,
    token: parsed.token,
    expiresAt: parsed.expiresAt,
    privateKey: keys.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    pairing: parsed.pairing,
  });
  process.stdout.write(`Paired node ${parsed.pairing.nodeId}\n`);
}

/**
 * 读取并校验允许读取的根路径映射：防止节点越权读任意主机路径。
 * 读取自环境变量 JSON，例如 {"workspace":"/abs/path"}。
 */
function readRoots(): Record<string, string> {
  const raw = process.env.EDUCANVAS_NODE_READ_ROOTS_JSON ?? '{}';
  const parsed = JSON.parse(raw) as unknown;
  return z.record(z.string(), z.string().min(1)).parse(parsed);
}

/**
 * 长轮询循环：心跳 + 拉取 invocations -> 本地执行器执行 -> 回传结果。
 * 401 认为配对已撤销，立即退出运行循环。
 */
async function run(): Promise<void> {
  const config = await loadConfig();
  const sessionId = randomUUID();
  let sequence = 0;
  let revoked = false;
  const executor = await SafeNodeHostExecutor.create({
    nodeId: config.nodeId,
    capabilities: config.pairing.approvedCapabilities,
    roots: readRoots(),
    revoked: () => revoked,
  });
  while (!revoked) {
    const now = new Date().toISOString();
    try {
      await requestJson(
        `${config.gatewayUrl.replace(/\/$/, '')}/v1/node/heartbeat`,
        config.token,
        {
          method: 'POST',
          body: JSON.stringify({
            nodeId: config.nodeId,
            sessionId,
            sequence,
            occurredAt: now,
            capabilities: config.pairing.approvedCapabilities,
          }),
        },
      );
      sequence += 1;
      const pending = z
        .object({ invocations: z.array(gatewayNodeInvocationRequestSchema) })
        .strict()
        .parse(
          await requestJson(
            `${config.gatewayUrl.replace(/\/$/, '')}/v1/node/invocations`,
            config.token,
          ),
        );
      for (const invocation of pending.invocations) {
        const result = await executor.execute(invocation);
        await requestJson(
          `${config.gatewayUrl.replace(/\/$/, '')}/v1/node/invocation-results`,
          config.token,
          { method: 'POST', body: JSON.stringify(result) },
        );
      }
    } catch (error) {
      // 仅识别明确鉴权失效，避免错误码偶发波动影响业务中断；
      // 其他错误保持循环，依赖短暂停顿后重试。
      if (error instanceof Error && error.message.includes('HTTP 401')) {
        revoked = true;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

/**
 * 本地 fixture 执行入口，便于 CI/运维回归单条调用链，不进入网关轮询循环。
 */
async function fixture(args: readonly string[]): Promise<void> {
  const [requestPath] = args;
  if (!requestPath) throw new Error('exec-fixture requires request.json');
  const config = await loadConfig();
  const request = gatewayNodeInvocationRequestSchema.parse(
    JSON.parse(await readFile(requestPath, 'utf8')),
  ) as GatewayNodeInvocationRequest;
  const executor = await SafeNodeHostExecutor.create({
    nodeId: config.nodeId,
    capabilities: config.pairing.approvedCapabilities,
    roots: readRoots(),
  });
  process.stdout.write(
    `${JSON.stringify(await executor.execute(request), null, 2)}\n`,
  );
}

// CLI 命令路由：pair/run/exec-fixture 任意一个，其他命令返回明确错误并退出码非0。
const [command, ...args] = process.argv.slice(2);
const action =
  command === 'pair'
    ? pair(args)
    : command === 'run'
      ? run()
      : command === 'exec-fixture'
        ? fixture(args)
        : Promise.reject(new Error('expected pair, run, or exec-fixture'));
action.catch((error: unknown) => {
  process.stderr.write(
    `[node] ${error instanceof Error ? error.message : 'Unknown error'}\n`,
  );
  process.exitCode = 1;
});
