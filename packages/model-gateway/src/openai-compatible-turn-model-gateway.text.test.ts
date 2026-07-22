import type { TurnModelEvent } from '@educanvas/agent-core';
import { describe, expect, it } from 'vitest';
import { OpenAICompatibleTurnModelGateway } from './openai-compatible-turn-model-gateway';
import {
  answerRequest,
  collect,
  config,
  oneResponseFetch,
} from './openai-compatible-turn-model-gateway.test-support';
import {
  createFixtureResponse,
  textStreamChunks,
} from './testing/openai-compatible-fixtures';

describe('OpenAI-compatible文本流', () => {
  it('严格映射文本、usage和完成元数据且绝不转发reasoning_content', async () => {
    let capturedInput: URL | RequestInfo | undefined;
    let capturedInit: RequestInit | undefined;
    const gateway = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(
        () => createFixtureResponse(textStreamChunks, { splitEvery: 7 }),
        (input, init) => {
          capturedInput = input;
          capturedInit = init;
        },
      ),
      now: () => 100,
    });
    const events = await collect(gateway);
    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'text_delta',
      'usage',
      'completed',
    ]);
    expect(events.slice(0, 2)).toEqual([
      { type: 'text_delta', phase: 'answer', delta: '猫和' },
      {
        type: 'text_delta',
        phase: 'answer',
        delta: '狗可以从耳朵等特征区分。',
      },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      metadata: {
        providerResponseId: 'fixture-response-id',
        provider: 'deepseek',
        taskAlias: 'teaching.turn',
        modelAlias: 'primary',
        resolvedModelId: 'explicitly-configured-model',
        modelRevision: 'configured-provider-model',
        systemFingerprint: 'fixture-fingerprint',
        finishReason: 'stop',
        usage: {
          inputTokens: 24,
          outputTokens: 9,
          cacheHitTokens: 4,
          reasoningTokens: 3,
        },
        latencyMs: 0,
        traceId: 'trace-fixture-1',
      },
    });
    expect(JSON.stringify(events)).not.toContain(
      'fixture-private-reasoning-never-forward',
    );
    expect(JSON.stringify(events)).not.toContain(config.apiKey);
    expect(String(capturedInput)).toBe(
      'https://api.deepseek.com/chat/completions',
    );
    expect(new Headers(capturedInit?.headers).get('authorization')).toBe(
      `Bearer ${config.apiKey}`,
    );
    const body = JSON.parse(String(capturedInit?.body)) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      model: 'explicitly-configured-model',
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 2_048,
      tool_choice: 'auto',
      thinking: { type: 'disabled' },
    });
    expect(body).not.toHaveProperty('user_id');
  });

  it('接受DeepSeek在终止choice中内联usage的SSE布局', async () => {
    const finishChunk = textStreamChunks.at(-2) as Record<string, unknown>;
    const usageChunk = textStreamChunks.at(-1) as Record<string, unknown>;
    const gateway = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(() =>
        createFixtureResponse(
          [
            ...textStreamChunks.slice(0, -2),
            { ...finishChunk, usage: usageChunk.usage },
          ],
          { splitEvery: 9 },
        ),
      ),
    });
    const events = await collect(gateway);
    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'text_delta',
      'usage',
      'completed',
    ]);
    expect(events.at(-1)).toMatchObject({
      metadata: {
        resolvedModelId: 'explicitly-configured-model',
        finishReason: 'stop',
        usage: { inputTokens: 24, outputTokens: 9 },
      },
    });
  });

  it('在供应商终止事件到达前立即交付首个文本增量', async () => {
    const encoder = new TextEncoder();
    let releaseRemaining!: () => void;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(textStreamChunks[0])}\r\n\r\n`,
            ),
          );
          releaseRemaining = () => {
            for (const chunk of textStreamChunks.slice(1)) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(chunk)}\r\n\r\n`),
              );
            }
            controller.enqueue(encoder.encode('data: [DONE]\r\n\r\n'));
            controller.close();
          };
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const iterator = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: oneResponseFetch(() => response),
    })
      .streamTurnText(answerRequest)
      [Symbol.asyncIterator]();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const first = await Promise.race([
      iterator.next(),
      new Promise<'timed-out'>((resolve) => {
        timeoutId = setTimeout(() => resolve('timed-out'), 200);
      }),
    ]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    expect(first).not.toBe('timed-out');
    expect(first).toMatchObject({
      done: false,
      value: { type: 'text_delta', delta: '猫和' },
    });
    releaseRemaining();
    const remainder: TurnModelEvent[] = [];
    for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
      remainder.push(event);
    }
    expect(remainder.at(-1)?.type).toBe('completed');
  });
});
