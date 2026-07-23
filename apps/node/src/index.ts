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
    gatewayUrl: z.string().url(),
    userId: z.string().min(1),
    nodeId: z.string().min(1),
    token: z.string().min(32),
    expiresAt: z.string().datetime({ offset: true }),
    privateKey: z.string().min(32),
    pairing: gatewayNodePairingRecordSchema,
  })
  .strict();

function configPath(): string {
  return path.join(os.homedir(), '.config', 'educanvas', 'node.json');
}

async function saveConfig(value: z.infer<typeof configSchema>): Promise<void> {
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(file, 0o600);
}

async function loadConfig() {
  return configSchema.parse(JSON.parse(await readFile(configPath(), 'utf8')));
}

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

function readRoots(): Record<string, string> {
  const raw = process.env.EDUCANVAS_NODE_READ_ROOTS_JSON ?? '{}';
  const parsed = JSON.parse(raw) as unknown;
  return z.record(z.string(), z.string().min(1)).parse(parsed);
}

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
      if (error instanceof Error && error.message.includes('HTTP 401')) {
        revoked = true;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

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
