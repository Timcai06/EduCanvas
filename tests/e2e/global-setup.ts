import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function structuredFixture(schemaPrompt: string): unknown {
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
  return {
    contentVersion: 1,
    root: { id: 'root', label: '对话思维导图' },
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
      });
      response.end(bytes);
      return;
    }
    if (request.url === '/v1/chat/completions') {
      const payload = (await readBody(request)) as {
        messages?: Array<{ content?: string }>;
      };
      const schemaPrompt = payload.messages?.at(-1)?.content ?? '';
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'e2e-structured-1',
          model: 'structured-e2e',
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify(structuredFixture(schemaPrompt)),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('E2E fixture Provider 启动失败');
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

/**
 * E2E 期间拉起真实 worker 进程(ADR-0012 的双进程形态必须被 E2E 覆盖,
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

  const worker: ChildProcess = spawn(
    'pnpm',
    ['--filter', '@educanvas/worker', 'exec', 'tsx', 'src/index.ts'],
    {
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
        OBJECT_STORAGE_ROOT: objectStorageRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('worker 启动超时(30s)')),
      30_000,
    );
    worker.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('已启动')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    worker.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[e2e-worker] ${chunk.toString()}`);
    });
    worker.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`worker 提前退出,code=${code}`));
    });
  });

  return async () => {
    worker.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!worker.killed) worker.kill('SIGKILL');
    await new Promise<void>((resolve, reject) =>
      fixtureProvider.server.close((error) =>
        error ? reject(error) : resolve(),
      ),
    );
    await rm(objectStorageRoot, { recursive: true, force: true });
  };
}
