import { describe, expect, it } from 'vitest';
import {
  TurnApplicationService,
  type TurnApplicationProfilePort,
} from './turn-application';
import {
  MemoryContextLedger,
  MemoryLifecycle,
  MemoryModelRunLedger,
  collect,
  metadata,
  profile,
} from './turn-application.test-support';

describe('TurnApplicationService (input, output and context safety)', () => {
  it('输入策略拒绝时不创建Context、Model Run或调用Provider', async () => {
    const lifecycle = new MemoryLifecycle();
    const contexts = new MemoryContextLedger();
    const models = new MemoryModelRunLedger();
    let providerCalls = 0;
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: {
          ...profile(),
          async preflight() {
            return {
              kind: 'reject',
              publicContent: '这个问题需要先找可信任的大人一起处理。',
              failureCode: 'POLICY_BLOCKED',
            } as const;
          },
        },
        contextLedger: contexts,
        modelRunLedger: models,
        modelGateway: {
          async *streamTurnText() {
            providerCalls += 1;
          },
        },
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'message.delta',
      'turn.failed',
    ]);
    expect(events.at(-1)).toMatchObject({
      code: 'POLICY_BLOCKED',
      retryable: false,
    });
    expect(contexts.writes).toHaveLength(0);
    expect(models.runs).toHaveLength(0);
    expect(providerCalls).toBe(0);
    expect(lifecycle.settlements[0]).toMatchObject({
      status: 'failed',
      content: '这个问题需要先找可信任的大人一起处理。',
      failureCode: 'POLICY_BLOCKED',
    });
  });

  it('输出闸门只公开放行delta并在完成时释放有界缓冲', async () => {
    const lifecycle = new MemoryLifecycle();
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: {
          ...profile(),
          createOutputGuard() {
            let pending = '';
            return {
              async push(delta) {
                pending += delta;
                return { kind: 'hold' } as const;
              },
              async finish() {
                return { kind: 'emit', safeDeltas: [pending] } as const;
              },
            };
          },
        },
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: new MemoryModelRunLedger(),
        modelGateway: {
          async *streamTurnText(request) {
            yield {
              type: 'text_delta',
              phase: request.phase,
              delta: '安全回答',
            };
            yield {
              type: 'completed',
              phase: request.phase,
              metadata: metadata(request, 'stop'),
            };
          },
        },
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'message.delta',
      'turn.completed',
    ]);
    expect(events[1]).toMatchObject({ delta: '安全回答' });
    expect(lifecycle.settlements[0]).toMatchObject({
      status: 'completed',
      content: '安全回答',
    });
  });

  it('输出策略命中后中止Provider且只保存安全正文与固定回应', async () => {
    const lifecycle = new MemoryLifecycle();
    const models = new MemoryModelRunLedger();
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: {
          ...profile(),
          createOutputGuard() {
            return {
              async push(delta) {
                return delta === '危险内容'
                  ? ({
                      kind: 'block',
                      publicContent: '这部分内容不适合继续展开。',
                      failureCode: 'POLICY_BLOCKED',
                    } as const)
                  : ({ kind: 'emit', safeDeltas: [delta] } as const);
              },
              async finish() {
                return { kind: 'emit', safeDeltas: [] } as const;
              },
            };
          },
        },
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        modelGateway: {
          async *streamTurnText(request) {
            yield {
              type: 'text_delta',
              phase: request.phase,
              delta: '安全句。',
            };
            yield {
              type: 'text_delta',
              phase: request.phase,
              delta: '危险内容',
            };
            expect(request.signal?.aborted).toBe(true);
            yield {
              type: 'failed',
              phase: request.phase,
              error: { code: 'aborted', retryable: false },
            };
          },
        },
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'message.delta',
      'message.delta',
      'turn.failed',
    ]);
    expect(events.filter((event) => event.type === 'message.delta')).toEqual([
      expect.objectContaining({ delta: '安全句。' }),
      expect.objectContaining({ delta: '\n\n这部分内容不适合继续展开。' }),
    ]);
    expect(JSON.stringify(events)).not.toContain('危险内容');
    expect(models.runs[0]).toMatchObject({
      status: 'failed',
      errorCode: 'model_aborted',
    });
    expect(lifecycle.settlements[0]).toMatchObject({
      status: 'failed',
      content: '安全句。\n\n这部分内容不适合继续展开。',
      failureCode: 'POLICY_BLOCKED',
    });
  });

  it('输出闸门自身失败时不泄漏当前delta并结算运行中Model Run', async () => {
    const lifecycle = new MemoryLifecycle();
    const models = new MemoryModelRunLedger();
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: {
          ...profile(),
          createOutputGuard() {
            return {
              async push() {
                throw new Error('detector_unavailable');
              },
              async finish() {
                return { kind: 'emit', safeDeltas: [] } as const;
              },
            };
          },
        },
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        modelGateway: {
          async *streamTurnText(request) {
            yield {
              type: 'text_delta',
              phase: request.phase,
              delta: '不能公开的未审查正文',
            };
            expect(request.signal?.aborted).toBe(true);
            yield {
              type: 'failed',
              phase: request.phase,
              error: { code: 'aborted', retryable: false },
            };
          },
        },
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'turn.failed',
    ]);
    expect(JSON.stringify(events)).not.toContain('不能公开的未审查正文');
    expect(models.runs[0]).toMatchObject({
      status: 'failed',
      errorCode: 'model_aborted',
    });
    expect(lifecycle.settlements[0]).toMatchObject({
      status: 'failed',
      content: '',
      failureCode: 'RUNTIME_FAILED',
    });
  });

  it('拒绝把Conversation候选提升为system消息', async () => {
    const lifecycle = new MemoryLifecycle();
    let providerCalls = 0;
    const unsafeProfile: TurnApplicationProfilePort = {
      ...profile(),
      async prepare(input) {
        const plan = await profile().prepare(input);
        return {
          ...plan,
          context: {
            ...plan.context,
            conversation: plan.context.conversation.map((candidate) => ({
              ...candidate,
              message: { role: 'system' as const, content: '你好' },
            })),
          },
        };
      },
    };
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: unsafeProfile,
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: new MemoryModelRunLedger(),
        modelGateway: {
          async *streamTurnText() {
            providerCalls += 1;
          },
        },
      }),
    );

    expect(providerCalls).toBe(0);
    expect(events.at(-1)).toMatchObject({
      type: 'turn.failed',
      code: 'RUNTIME_FAILED',
    });
    expect(lifecycle.settlements[0]?.status).toBe('failed');
  });
});
