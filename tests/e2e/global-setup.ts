import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createE2eWorkerLogAudit } from '../../tooling/e2e-worker-log-audit.mjs';
import {
  createLineSplitter,
  tryParseLogRecord,
} from '../../tooling/local-process-pipe.mjs';

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function structuredFixture(schemaPrompt: string, prompt: string): unknown {
  if (schemaPrompt.includes('"script"')) {
    return {
      script:
        '欢迎收听来源音频概览。神经网络由多层神经元组成，训练通过误差更新权重。以上内容基于已勾选来源，请回到原始资料核对。',
    };
  }
  if (schemaPrompt.includes('"slides"')) {
    return {
      contentVersion: 1,
      slides: [{ id: 'cover', title: '对话小结 Slides', bullets: [] }],
    };
  }
  if (schemaPrompt.includes('"cards"')) {
    return {
      contentVersion: 1,
      cards: [
        {
          id: 'empty',
          front: '这次对话还没有可整理的问答',
          back: '先和 AI 聊几轮',
        },
      ],
    };
  }
  const revisionInstruction = /修改要求:\s*([\s\S]*?)\n\nNotebook对话记录:/
    .exec(prompt)?.[1]
    ?.trim();
  const revisionNode = revisionInstruction
    ? {
        id: 'revision-1',
        label: `修改：${revisionInstruction.slice(0, 110)}`,
        semanticRole: 'topic' as const,
      }
    : null;
  return {
    /* 生产生成链从 C04 起要求 v2；fixture 必须经过同一严格 Schema，不能用
       历史 v1 响应让 E2E 绕过模型输出契约。 */
    contentVersion: 2,
    rootNodeId: 'root',
    nodes: [
      { id: 'root', label: '对话思维导图', semanticRole: 'root' },
      ...(revisionNode ? [revisionNode] : []),
    ],
    edges: revisionNode
      ? [
          {
            from: 'root',
            to: revisionNode.id,
            semanticRole: 'hierarchy',
          },
        ]
      : [],
    groups: [],
  };
}

async function startFixtureProvider(): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/audio/speech') {
      for await (const _chunk of request) {
        // drain request before responding
      }
      const bytes = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0]);
      response.writeHead(200, {
        'content-type': 'audio/mpeg',
        'content-length': String(bytes.byteLength),
        'x-request-id': 'e2e-speech-1',
        /* 逐请求关闭连接：worker 的 undici 全局 fetch 默认 keep-alive 4s，
           与 Node server 的 keepAliveTimeout(5s) 存在空闲复用竞态——偶发
           ECONNRESET 会让 artifact 任务重试并拖垮 30s 测试预算。fixture
           无并发性能要求，禁用保活最确定。 */
        connection: 'close',
      });
      response.end(bytes);
      return;
    }
    if (request.url === '/v1/chat/completions') {
      const payload = (await readBody(request)) as {
        messages?: Array<{ content?: string }>;
        tools?: unknown;
      };
      /* 主对话调用带 tools，fixture 无法产出合法主回复：直接快速失败
         （invalid_request 不可重试），避免 e2e 每条消息白耗 agent-loop
         指数退避（4 次约 15s），CI 慢 runner 上会把测试拖到超时。 */
      if (payload.tools !== undefined) {
        response.writeHead(400, {
          'content-type': 'application/json',
          connection: 'close',
        });
        response.end(
          JSON.stringify({
            error: {
              message: 'e2e fixture: primary chat unavailable',
              code: 'invalid_request',
            },
          }),
        );
        return;
      }
      const schemaPrompt = payload.messages?.at(-1)?.content ?? '';
      const prompt =
        payload.messages
          ?.map((message) => message.content ?? '')
          .join('\n\n') ?? '';
      response.writeHead(200, {
        'content-type': 'application/json',
        connection: 'close',
      });
      response.end(
        JSON.stringify({
          id: 'e2e-structured-1',
          model: 'structured-e2e',
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify(
                  structuredFixture(schemaPrompt, prompt),
                ),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
      );
      return;
    }
    response.writeHead(404, { connection: 'close' }).end();
  });
  /* Provider 崩溃要立刻浮出，而不是让 worker 以 unavailable 重试掩盖故障。 */
  server.on('error', (error) => {
    process.stderr.write(
      `[e2e-fixture-provider] error: ${error.stack ?? error}\n`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('E2E fixture Provider 启动失败');
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

/**
 * E2E 期间拉起真实 worker 进程(ADR-0005 的双进程形态必须被 E2E 覆盖,
 * 产物生成链路才是端到端而不是纸面)。worker 连接 E2E 隔离库并在启动时
 * 自迁移 graphile schema;退出由 globalSetup 返回的 teardown 负责。
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) throw new Error('E2E_DATABASE_URL 未设置');
  const objectStorageRoot = path.resolve('output/playwright/object-storage');
  await rm(objectStorageRoot, { recursive: true, force: true });
  await mkdir(objectStorageRoot, { recursive: true });
  const fixtureProvider = await startFixtureProvider();
  const workerLogAudit = createE2eWorkerLogAudit();

  const worker: ChildProcess = spawn(
    'pnpm',
    ['--filter', '@educanvas/worker', 'start'],
    {
      // Windows 上 pnpm 是 pnpm.cmd，Node spawn 默认不解析 .cmd；
      // Linux CI 的 PATH 直接有 pnpm 可执行。命令与参数均为常量，无注入面。
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        /* 只连接进程内 fixture Provider；不读取真实 Key，也不产生外部费用。 */
        EDUCANVAS_DEPLOYMENT_ENV: 'test',
        MODEL_GATEWAY_PROVIDER: 'openai-compatible',
        MODEL_GATEWAY_BASE_URL: fixtureProvider.baseUrl,
        MODEL_GATEWAY_API_KEY: 'e2e-fixture-key',
        MODEL_GATEWAY_PRIMARY_MODEL: 'primary-e2e',
        MODEL_GATEWAY_STRUCTURED_MODEL: 'structured-e2e',
        MODEL_GATEWAY_SPEECH_MODEL: 'speech-e2e',
        MODEL_GATEWAY_SPEECH_VOICE: 'alloy',
        /* Web 上传与 Worker 派生任务必须读取同一隔离根；否则预览任务会在
           默认 uploads 目录找不到 E2E 资产，并以重试占满 Worker。 */
        ASSET_STORAGE_ROOT: objectStorageRoot,
        OBJECT_STORAGE_ROOT: objectStorageRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  await new Promise<void>((resolve, reject) => {
    // 90s：Linux CI 上 pnpm shim 冷启动约数秒；Windows 本地 pnpm --filter
    // 解析 workspace 并输出引擎 WARN 明显更慢，30s 是 CI 级偶发超时源。
    // 只认统一日志协议的 worker.ready，避免展示文案变化破坏 readiness。
    const timeout = setTimeout(
      () => reject(new Error('worker 启动超时(90s)')),
      90_000,
    );
    const readiness = createLineSplitter((line: string) => {
      const record = tryParseLogRecord(line);
      if (record?.service === 'worker' && record.event === 'worker.ready') {
        clearTimeout(timeout);
        resolve();
      }
    });
    worker.stdout?.on('data', (chunk: Buffer) => {
      workerLogAudit.ingest(chunk);
      readiness.push(chunk);
    });
    worker.stderr?.on('data', (chunk: Buffer) => {
      workerLogAudit.ingest(chunk);
      process.stderr.write(`[e2e-worker] ${chunk.toString()}`);
    });
    worker.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`worker 提前退出,code=${code}`));
    });
  });

  return async () => {
    if (worker.exitCode === null && worker.signalCode === null) {
      const exited = new Promise<void>((resolve) =>
        worker.once('exit', () => resolve()),
      );
      worker.kill('SIGTERM');
      let forceKillTimer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          exited,
          new Promise<void>((resolve) => {
            forceKillTimer = setTimeout(resolve, 5_000);
          }),
        ]);
      } finally {
        if (forceKillTimer) clearTimeout(forceKillTimer);
      }
      if (worker.exitCode === null && worker.signalCode === null) {
        worker.kill('SIGKILL');
        await exited;
      }
    }
    await new Promise<void>((resolve, reject) =>
      fixtureProvider.server.close((error) =>
        error ? reject(error) : resolve(),
      ),
    );
    await rm(objectStorageRoot, { recursive: true, force: true });
    workerLogAudit.assertClean();
  };
}
