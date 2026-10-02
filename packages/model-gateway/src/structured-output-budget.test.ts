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
});
