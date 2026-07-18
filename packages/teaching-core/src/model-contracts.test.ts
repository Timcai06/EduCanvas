import { describe, expect, it } from 'vitest';
import {
  ModelGatewayInvocationError,
  type ModelAbortSignal,
  modelAliasSchema,
  normalizeModelGatewayError,
  providerCallMetadataSchema,
  structuredTaskAliasSchema,
  taskAliasSchema,
  turnModelEventSchema,
} from './model-contracts';

const usage = {
  inputTokens: 12,
  outputTokens: 4,
  cacheHitTokens: 0,
  reasoningTokens: 0,
};

const metadata = {
  providerResponseId: 'response-1',
  provider: 'fixture-provider',
  taskAlias: 'teaching.turn',
  modelAlias: 'primary',
  resolvedModelId: 'fixture/model-v1',
  modelRevision: '2026-07-15',
  systemFingerprint: null,
  finishReason: 'stop',
  usage,
  latencyMs: 18,
  traceId: 'trace-1',
} as const;

describe('model contracts', () => {
  it('区分业务任务别名、模型档位和结构化任务边界', () => {
    expect(taskAliasSchema.parse('teaching.turn')).toBe('teaching.turn');
    expect(modelAliasSchema.parse('primary')).toBe('primary');
    expect(structuredTaskAliasSchema.safeParse('teaching.turn').success).toBe(
      false,
    );
    expect(structuredTaskAliasSchema.parse('artifact.generate')).toBe(
      'artifact.generate',
    );
  });

  it('接受文本、分块工具参数、usage和completed事件', () => {
    const events = [
      { type: 'text_delta', phase: 'answer', delta: '猫的' },
      {
        type: 'tool_call',
        phase: 'answer',
        callId: 'state-1',
        tool: 'getStudentState',
        argumentsDelta: '{',
        done: false,
      },
      {
        type: 'tool_call',
        phase: 'answer',
        callId: 'state-1',
        tool: 'getStudentState',
        argumentsDelta: '}',
        done: true,
      },
      { type: 'usage', phase: 'answer', usage },
      { type: 'completed', phase: 'answer', metadata },
    ];

    expect(events.map((event) => turnModelEventSchema.parse(event))).toEqual(
      events,
    );
    expect(providerCallMetadataSchema.parse(metadata)).toEqual(metadata);
  });

  it.each([
    {
      label: '未知事件类型',
      event: { type: 'provider.delta', phase: 'answer', delta: 'x' },
    },
    {
      label: '供应商私有字段',
      event: {
        type: 'completed',
        phase: 'answer',
        metadata,
        rawProviderBody: 'secret',
      },
    },
    {
      label: '负Token',
      event: {
        type: 'usage',
        phase: 'answer',
        usage: { ...usage, outputTokens: -1 },
      },
    },
  ])('拒绝畸形或泄漏供应商细节的事件：$label', ({ event }) => {
    expect(turnModelEventSchema.safeParse(event).success).toBe(false);
  });

  it('稳定映射显式错误、Abort和未知异常且不泄漏异常文本', () => {
    const mapped = normalizeModelGatewayError(
      new ModelGatewayInvocationError(
        { code: 'rate_limit', retryable: true, retryAfterMs: 1_000 },
        { cause: new Error('provider-secret') },
      ),
    );
    expect(mapped).toEqual({
      code: 'rate_limit',
      retryable: true,
      retryAfterMs: 1_000,
    });
    expect(JSON.stringify(mapped)).not.toContain('provider-secret');

    const abortListeners = new Set<() => void>();
    const signal: ModelAbortSignal = {
      aborted: true,
      addEventListener(_type, listener) {
        abortListeners.add(listener);
      },
      removeEventListener(_type, listener) {
        abortListeners.delete(listener);
      },
    };
    const listener = () => undefined;
    signal.addEventListener('abort', listener, { once: true });
    expect(abortListeners.has(listener)).toBe(true);
    signal.removeEventListener('abort', listener);
    expect(abortListeners.has(listener)).toBe(false);
    expect(normalizeModelGatewayError(new Error('disconnect'), signal)).toEqual(
      { code: 'aborted', retryable: false },
    );
    expect(normalizeModelGatewayError(new Error('unknown-secret'))).toEqual({
      code: 'unknown',
      retryable: false,
    });
  });
});
