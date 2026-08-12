import type { StructuredModelGateway } from '@educanvas/agent-core';
import type { StructuredModelRequest } from '@educanvas/agent-core';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { webAppContentSchema } from '@educanvas/canvas-protocol/server';
import {
  MODEL_GENERATOR,
  MODEL_REVISION_GENERATOR,
  RULE_GENERATOR,
  RULE_REVISION_GENERATOR,
  generateWebAppContent,
} from './web-app-generation';

type Message = { role: 'user' | 'assistant'; content: string };

const messages = [
  { role: 'user', content: '帮我生成一个课程互动小页面：函数概念。' },
  { role: 'assistant', content: '可以，用卡片和列表来组织。' },
] as const satisfies Message[];

function makeModelOutput(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    manifest: {
      entry: 'index.html',
      files: [
        {
          path: 'index.html',
          mediaType: 'text/html',
          content:
            '<!doctype html><html><body><h1>函数概念</h1><script src="app.js"></script></body></html>',
          hash: '0'.repeat(64),
        },
        {
          path: 'styles.css',
          mediaType: 'text/css',
          content: 'body{font-family:sans-serif}',
          hash: '0'.repeat(64),
        },
        {
          path: 'app.js',
          mediaType: 'text/javascript',
          content: 'document.body.textContent = "ok";',
          hash: '0'.repeat(64),
        },
      ],
    },
    lockedDependencies: [],
    capabilities: ['dom-manipulation', 'css-render', 'javascript-runtime'],
    budget: {
      maxInputBytes: 1,
      maxMessageBytes: 1,
      maxOutputBytes: 1,
      maxDurationMs: 1,
      maxConcurrentInstances: 1,
      maxQueueDepth: 1,
      maxMessagesPerSecond: 1,
    },
    diagnostics: [{ code: 'build_failed' }],
    generatedByModel: false,
    ...overrides,
  };
}

const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

describe('generateWebAppContent', () => {
  it('fallback 生成 deterministic 初始版本并覆盖安全字段', async () => {
    const result = await generateWebAppContent({
      title: '函数概念',
      messages,
      gateway: null,
      traceId: 'trace-1',
      operationId: 'job-1',
    });

    expect(result.generatedBy).toBe(RULE_GENERATOR);
    const parsed = webAppContentSchema.parse(result.content);
    expect(parsed.lockedDependencies).toHaveLength(0);
    expect(parsed.generatedByModel).toBe(false);
    expect(parsed.manifest.entry).toBe('index.html');
    expect(parsed.manifest.files.map((file) => file.path)).toEqual([
      'index.html',
      'styles.css',
      'app.js',
    ]);
    expect(parsed.diagnostics).toMatchObject([{ code: 'build_succeeded' }]);
    for (const file of parsed.manifest.files) {
      expect(file.hash).toBe(hash(file.content));
      expect(file.content).not.toMatch(/https?:\/\//);
    }
  });

  it('fallback revision 生成完整新版本并保留指令', async () => {
    const result = await generateWebAppContent({
      title: '函数概念',
      messages,
      gateway: null,
      traceId: 'trace-2',
      operationId: 'job-2',
      revision: {
        instruction: '请把示例加粗',
        baseContent: makeModelOutput(),
      },
    });

    expect(result.generatedBy).toBe(RULE_REVISION_GENERATOR);
    expect(result.content.generatedByModel).toBe(false);
    expect(result.content.manifest.files[0]!.content).toContain('请把示例加粗');
  });

  it('调用网关时生成并覆盖 model 可控字段', async () => {
    const modelOutput = makeModelOutput();
    const generateStructured = vi.fn(
      async (_request: StructuredModelRequest<unknown>) => ({
        output: modelOutput,
        metadata: {} as never,
      }),
    );
    const gateway = { generateStructured } as StructuredModelGateway;

    const result = await generateWebAppContent({
      title: '函数概念',
      messages,
      gateway,
      traceId: 'trace-3',
      operationId: 'job-3',
    });

    expect(result.generatedBy).toBe(MODEL_GENERATOR);
    expect(result.content.generatedByModel).toBe(true);
    expect(result.content.lockedDependencies).toEqual([]);
    expect(result.content.budget).toMatchObject({
      maxInputBytes: 8_192,
      maxMessageBytes: 8_192,
    });
    expect(result.content.diagnostics).toMatchObject([
      { code: 'build_succeeded' },
    ]);
    for (const file of result.content.manifest.files) {
      expect(file.hash).toBe(hash(file.content));
    }
    expect(result.content.capabilities).toEqual([
      'dom-manipulation',
      'css-render',
      'javascript-runtime',
    ]);
    const input = generateStructured.mock.calls[0]![0] as unknown as {
      promptVersion: string;
      taskAlias: string;
    };
    expect(input.taskAlias).toBe('artifact.generate');
    expect(input.promptVersion).toBe('artifact-web-app-v1');
  });

  it('调用网关 revision 时使用 revision prompt，并重算哈希', async () => {
    const generateStructured = vi.fn(
      async (_request: StructuredModelRequest<unknown>) => ({
        output: makeModelOutput({
          diagnostics: [{ code: 'build_pending' }],
          budget: {
            maxInputBytes: 1,
            maxMessageBytes: 1,
            maxOutputBytes: 1,
            maxDurationMs: 1,
            maxConcurrentInstances: 1,
            maxQueueDepth: 1,
            maxMessagesPerSecond: 1,
          },
        }),
        metadata: {} as never,
      }),
    );
    const gateway = { generateStructured } as StructuredModelGateway;

    const result = await generateWebAppContent({
      title: '函数概念',
      messages,
      gateway,
      traceId: 'trace-4',
      operationId: 'job-4',
      revision: {
        instruction: '把页面风格改成暗色',
        baseContent: makeModelOutput(),
      },
    });

    expect(result.generatedBy).toBe(MODEL_REVISION_GENERATOR);
    const request = generateStructured.mock.calls[0]![0] as unknown as {
      promptVersion: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(request.promptVersion).toBe('artifact-web-app-revision-v1');
    expect(request.messages.some((m) => m.content.includes('修改要求'))).toBe(
      true,
    );
    for (const file of result.content.manifest.files) {
      expect(file.hash).toBe(hash(file.content));
    }
    expect(result.content.diagnostics[0]).toMatchObject({
      code: 'build_succeeded',
    });
  });

  it('reject 由模型返回的外部网络引用', async () => {
    const generateStructured = vi.fn(async () => ({
      output: makeModelOutput({
        manifest: {
          entry: 'index.html',
          files: [
            {
              path: 'index.html',
              mediaType: 'text/html',
              content:
                '<!doctype html><html><body><script src="https://cdn.example.com/a.js"></script></body></html>',
              hash: '0'.repeat(64),
            },
          ],
        },
      } as any),
      metadata: {} as never,
    }));
    const gateway = { generateStructured } as StructuredModelGateway;

    await expect(
      generateWebAppContent({
        title: '函数概念',
        messages,
        gateway,
        traceId: 'trace-5',
        operationId: 'job-5',
      }),
    ).rejects.toThrow();
  });

  it('reject 由模型返回的 JS import', async () => {
    const generateStructured = vi.fn(async () => ({
      output: makeModelOutput({
        manifest: {
          entry: 'index.html',
          files: [
            {
              path: 'index.html',
              mediaType: 'text/html',
              content:
                '<!doctype html><html><body><script>const a=1;</script><script src="app.js"></script></body></html>',
              hash: '0'.repeat(64),
            },
            {
              path: 'styles.css',
              mediaType: 'text/css',
              content: 'body{color:red}',
              hash: '0'.repeat(64),
            },
            {
              path: 'app.js',
              mediaType: 'text/javascript',
              content: 'import foo from "./foo.js";\nfoo();',
              hash: '0'.repeat(64),
            },
          ],
        },
      } as any),
      metadata: {} as never,
    }));

    const gateway = { generateStructured } as StructuredModelGateway;

    await expect(
      generateWebAppContent({
        title: '函数概念',
        messages,
        gateway,
        traceId: 'trace-6',
        operationId: 'job-6',
      }),
    ).rejects.toThrow();
  });

  it('reject 模型注入越权字段（strict schema）', async () => {
    const generateStructured = vi.fn(async () => ({
      output: {
        ...makeModelOutput(),
        provider: 'evil',
      },
      metadata: {} as never,
    }));
    const gateway = { generateStructured } as StructuredModelGateway;

    await expect(
      generateWebAppContent({
        title: '函数概念',
        messages,
        gateway,
        traceId: 'trace-7',
        operationId: 'job-7',
      }),
    ).rejects.toThrow();
  });
});
