import { ModelGatewayInvocationError } from '@educanvas/agent-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { EnabledModelGatewayConfiguration } from './config';
import { OpenAICompatibleStructuredModelGateway } from './openai-compatible-structured-model-gateway';

const config: EnabledModelGatewayConfiguration = {
  enabled: true,
  environment: 'test',
  provider: 'openai-compatible',
  runtime: 'native',
  baseUrl: 'https://provider.example/v1',
  apiKey: 'test-key',
  modelIds: { primary: 'model-primary', structured: 'model-structured' },
  timeoutMs: 5_000,
  maxOutputTokens: 2_000,
  speechVoice: 'alloy',
  speechTimeoutMs: 60_000,
  speechMaxInputChars: 3_500,
};

const outputSchema = z.object({ answer: z.string() }).strict();

const request = {
  taskAlias: 'artifact.generate' as const,
  modelAlias: 'structured' as const,
  messages: [{ role: 'user' as const, content: '给我一个答案' }],
  schema: outputSchema,
  promptVersion: 'test-v1',
  traceId: 'trace-1',
  operationId: 'op-1',
};

const fetchStub =
  (handler: (init: RequestInit) => Response | Promise<Response>) =>
  async (_input: string | URL | Request, init?: RequestInit) =>
    handler(init!);

describe('OpenAICompatibleStructuredModelGateway', () => {
  it('解析 JSON 输出并产出完整审计元数据;适配器注入 Schema 说明', async () => {
    let capturedBody = '';
    const gateway = new OpenAICompatibleStructuredModelGateway(config, {
      fetchImpl: fetchStub((init) => {
        capturedBody = String(init.body);
        return Response.json({
          id: 'resp-1',
          model: 'model-structured-2026',
          choices: [
            {
              finish_reason: 'stop',
              message: { content: '{"answer":"42"}' },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
      }),
    });

    const result = await gateway.generateStructured(request);
    expect(result.output).toEqual({ answer: '42' });
    expect(result.metadata).toMatchObject({
      provider: 'openai-compatible',
      taskAlias: 'artifact.generate',
      resolvedModelId: 'model-structured-2026',
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
      traceId: 'trace-1',
    });
    const parsed = JSON.parse(capturedBody) as {
      model: string;
      stream: boolean;
      response_format: { type: string };
      messages: { role: string; content: string }[];
    };
    expect(parsed.model).toBe('model-structured');
    expect(parsed.stream).toBe(false);
    expect(parsed.response_format.type).toBe('json_object');
    expect(parsed.messages.at(-1)?.content).toContain('JSON Schema');
  });

  it('内容不过调用方 Schema 时以 invalid_response 失败,不静默修复', async () => {
    const gateway = new OpenAICompatibleStructuredModelGateway(config, {
      fetchImpl: fetchStub(() =>
        Response.json({
          choices: [
            { finish_reason: 'stop', message: { content: '{"wrong":true}' } },
          ],
        }),
      ),
    });
    await expect(gateway.generateStructured(request)).rejects.toMatchObject({
      normalized: { code: 'invalid_response', retryable: false },
    });
  });

  it.each([
    [429, 'rate_limit'],
    [503, 'unavailable'],
    [400, 'invalid_response'],
  ])('HTTP %s 归一为 %s', async (status, code) => {
    const gateway = new OpenAICompatibleStructuredModelGateway(config, {
      fetchImpl: fetchStub(() => new Response('err', { status })),
    });
    await expect(gateway.generateStructured(request)).rejects.toMatchObject({
      normalized: { code },
    });
  });

  it('finish_reason=length 归一为 output_limit', async () => {
    const gateway = new OpenAICompatibleStructuredModelGateway(config, {
      fetchImpl: fetchStub(() =>
        Response.json({
          choices: [{ finish_reason: 'length', message: { content: '{}' } }],
        }),
      ),
    });
    const rejected = gateway.generateStructured(request);
    await expect(rejected).rejects.toBeInstanceOf(ModelGatewayInvocationError);
    await expect(rejected).rejects.toMatchObject({
      normalized: { code: 'output_limit' },
    });
  });
});
