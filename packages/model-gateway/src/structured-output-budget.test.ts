import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseModelGatewayConfiguration } from './config/config';
import { OpenAICompatibleStructuredModelGateway } from './openai-compatible-structured-model-gateway';

describe('long artifact output budget', () => {
  it.each([
    [
      'deepseek-v4-pro',
      'https://api.deepseek.com',
      'artifact.generate',
      'long_artifact',
      32768,
    ],
    [
      'deepseek-flash',
      'https://api.deepseek.com',
      'artifact.generate',
      'long_artifact',
      32768,
    ],
    [
      'deepseek-v4-pro',
      'https://api.deepseek.com',
      'artifact.generate',
      'configured',
      8192,
    ],
    [
      'deepseek-v4-pro',
      'https://api.deepseek.com',
      'retrieval.query_rewrite',
      'long_artifact',
      8192,
    ],
    [
      'deepseek-chat',
      'https://api.deepseek.com',
      'artifact.generate',
      'long_artifact',
      8192,
    ],
    [
      'deepseek-v4-pro',
      'https://proxy.example',
      'artifact.generate',
      'long_artifact',
      8192,
    ],
  ] as const)(
    'sends a verified budget for %s / %s / %s / %s',
    async (model, baseUrl, taskAlias, outputBudget, expected) => {
      const config = parseModelGatewayConfiguration({
        EDUCANVAS_DEPLOYMENT_ENV: 'test',
        MODEL_GATEWAY_PROVIDER:
          baseUrl === 'https://proxy.example'
            ? 'openai-compatible'
            : 'deepseek',
        MODEL_GATEWAY_ALLOW_DEEPSEEK: 'true',
        MODEL_GATEWAY_API_KEY: 'fixture-key',
        MODEL_GATEWAY_BASE_URL: baseUrl,
        MODEL_GATEWAY_PRIMARY_MODEL: model,
        MODEL_GATEWAY_STRUCTURED_MODEL: model,
        MODEL_GATEWAY_STRUCTURED_MAX_OUTPUT_TOKENS: '8192',
      });
      if (!config.enabled) throw new Error('fixture unavailable');
      let body: Record<string, unknown> = {};
      const gateway = new OpenAICompatibleStructuredModelGateway(config, {
        outputBudget,
        fetchImpl: async (_url, init) => {
          body = JSON.parse(String(init?.body));
          return Response.json({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: '{"answer":"complete"}' },
              },
            ],
          });
        },
      });
      await gateway.generateStructured({
        taskAlias,
        modelAlias: 'structured',
        messages: [{ role: 'user', content: 'fixture' }],
        schema: z.object({ answer: z.string() }).strict(),
        promptVersion: 'test-v1',
        traceId: 'trace',
        operationId: 'op',
      });
      expect(body.max_tokens).toBe(expected);
      expect(config.structuredMaxOutputTokens).toBe(8192);
      expect(config.maxOutputTokens).toBe(2048);
    },
  );

  it('调用级上限不会抬高已配置或已核实的模型上限', async () => {
    const config = parseModelGatewayConfiguration({
      EDUCANVAS_DEPLOYMENT_ENV: 'test',
      MODEL_GATEWAY_PROVIDER: 'openai-compatible',
      MODEL_GATEWAY_API_KEY: 'fixture-key',
      MODEL_GATEWAY_BASE_URL: 'https://proxy.example',
      MODEL_GATEWAY_PRIMARY_MODEL: 'proxy-model',
      MODEL_GATEWAY_STRUCTURED_MODEL: 'proxy-model',
      MODEL_GATEWAY_STRUCTURED_MAX_OUTPUT_TOKENS: '4096',
    });
    if (!config.enabled) throw new Error('fixture unavailable');
    const captured: number[] = [];
    const gateway = new OpenAICompatibleStructuredModelGateway(config, {
      outputBudget: 'long_artifact',
      fetchImpl: async (_url, init) => {
        captured.push(JSON.parse(String(init?.body)).max_tokens as number);
        return Response.json({
          choices: [
            { finish_reason: 'stop', message: { content: '{"answer":"ok"}' } },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
      },
    });
    const common = {
      taskAlias: 'artifact.generate' as const,
      modelAlias: 'structured' as const,
      messages: [{ role: 'user' as const, content: 'fixture' }],
      schema: z.object({ answer: z.string() }).strict(),
      promptVersion: 'test-v1',
      traceId: 'trace',
      operationId: 'op',
    };
    await gateway.generateStructured({ ...common, maxOutputTokens: 1024 });
    await gateway.generateStructured({ ...common, maxOutputTokens: 8192 });
    expect(captured).toEqual([1024, 4096]);

    await expect(
      gateway.generateStructured({ ...common, maxOutputTokens: 0 }),
    ).rejects.toMatchObject({ normalized: { code: 'invalid_response' } });
  });
});
