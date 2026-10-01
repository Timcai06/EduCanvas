import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ModelGatewayEnvironment } from '@educanvas/model-gateway';
import { createWorkerModelRuntime } from './model-runtime';

const environment: ModelGatewayEnvironment = {
  EDUCANVAS_DEPLOYMENT_ENV: 'local',
  MODEL_GATEWAY_PROVIDER: 'deepseek',
  MODEL_GATEWAY_ALLOW_DEEPSEEK: 'true',
  MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com',
  MODEL_GATEWAY_API_KEY: 'fixture-key',
  MODEL_GATEWAY_PRIMARY_MODEL: 'deepseek-v4-pro',
  MODEL_GATEWAY_STRUCTURED_MODEL: 'deepseek-v4-pro',
  MODEL_GATEWAY_MAX_OUTPUT_TOKENS: '2048',
  MODEL_GATEWAY_STRUCTURED_MAX_OUTPUT_TOKENS: '8192',
};

afterEach(() => vi.unstubAllGlobals());

describe('Worker structured output budget request boundary', () => {
  it.each([
    ['default runtime', undefined, {}, 'artifact.generate', 'structured', 8192],
    [
      'explicit configured',
      'configured',
      {},
      'artifact.generate',
      'structured',
      8192,
    ],
    [
      'verified long artifact',
      'long_artifact',
      {},
      'artifact.generate',
      'structured',
      32768,
    ],
    [
      'verified flash model',
      'long_artifact',
      { MODEL_GATEWAY_STRUCTURED_MODEL: 'deepseek-flash' },
      'artifact.generate',
      'structured',
      32768,
    ],
    [
      'larger configured budget',
      'long_artifact',
      { MODEL_GATEWAY_STRUCTURED_MAX_OUTPUT_TOKENS: '65536' },
      'artifact.generate',
      'structured',
      65536,
    ],
    [
      'unknown structured model',
      'long_artifact',
      { MODEL_GATEWAY_STRUCTURED_MODEL: 'unknown-future-model' },
      'artifact.generate',
      'structured',
      8192,
    ],
    [
      'proxy endpoint',
      'long_artifact',
      {
        MODEL_GATEWAY_PROVIDER: 'openai-compatible',
        MODEL_GATEWAY_BASE_URL: 'https://proxy.example/v1',
      },
      'artifact.generate',
      'structured',
      8192,
    ],
    [
      'lookalike hostname',
      'long_artifact',
      {
        MODEL_GATEWAY_PROVIDER: 'openai-compatible',
        MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com.proxy.example/v1',
      },
      'artifact.generate',
      'structured',
      8192,
    ],
    [
      'different provider',
      'long_artifact',
      { MODEL_GATEWAY_PROVIDER: 'openai-compatible' },
      'artifact.generate',
      'structured',
      8192,
    ],
    [
      'retrieval task',
      'long_artifact',
      {},
      'retrieval.query_rewrite',
      'structured',
      8192,
    ],
    [
      'primary alias',
      'long_artifact',
      {},
      'artifact.generate',
      'primary',
      8192,
    ],
    [
      'unknown primary fallback',
      'long_artifact',
      {
        MODEL_GATEWAY_PRIMARY_MODEL: 'unknown-future-model',
        MODEL_GATEWAY_STRUCTURED_MODEL: undefined,
      },
      'artifact.generate',
      'structured',
      8192,
    ],
  ] as const)(
    '%s sends the scoped budget without mutating deployment configuration',
    async (_name, outputBudget, overrides, taskAlias, modelAlias, expected) => {
      const configuredEnvironment: ModelGatewayEnvironment = {
        ...environment,
        ...overrides,
      };
      const originalEnvironment = { ...configuredEnvironment };
      const fetchMock = vi.fn<typeof fetch>(async () =>
        Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: '{"answer":"complete"}' },
            },
          ],
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const runtime = createWorkerModelRuntime(
        configuredEnvironment,
        outputBudget,
      );
      if (!runtime.structured) throw new Error('fixture runtime unavailable');
      await runtime.structured.generateStructured({
        taskAlias,
        modelAlias,
        messages: [{ role: 'user', content: 'fixture' }],
        schema: z.object({ answer: z.string() }).strict(),
        promptVersion: 'fixture-v1',
        traceId: 'trace',
        operationId: 'operation',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(body.max_tokens).toBe(expected);
      expect(body.model).toBe(
        configuredEnvironment.MODEL_GATEWAY_STRUCTURED_MODEL ??
          configuredEnvironment.MODEL_GATEWAY_PRIMARY_MODEL,
      );
      expect(configuredEnvironment).toEqual(originalEnvironment);
    },
  );

  it.each([
    'MODEL_GATEWAY_MAX_OUTPUT_TOKENS',
    'MODEL_GATEWAY_STRUCTURED_MAX_OUTPUT_TOKENS',
  ] as const)('keeps the existing configuration hard bound for %s', (key) => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    expect(() =>
      createWorkerModelRuntime(
        { ...environment, [key]: '65537' },
        'long_artifact',
      ),
    ).toThrow('INVALID_MAX_OUTPUT_TOKENS');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unofficial DeepSeek endpoint before making a request', () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    expect(() =>
      createWorkerModelRuntime(
        {
          ...environment,
          MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com.proxy.example/v1',
        },
        'long_artifact',
      ),
    ).toThrow('INVALID_BASE_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
