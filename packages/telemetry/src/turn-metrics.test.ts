import type { TurnApplicationEvent } from '@educanvas/agent-core';
import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from './metrics';
import { wrapTurnApplicationStream } from './turn-metrics';

const event = (
  type: TurnApplicationEvent['type'],
  overrides: Record<string, unknown> = {},
): TurnApplicationEvent =>
  ({
    protocol: 'educanvas.turn.v2',
    operationId: 'op-1',
    ...overrides,
    type,
  }) as TurnApplicationEvent;

async function collect(
  registry: MetricsRegistry,
  events: TurnApplicationEvent[],
  now: () => number,
): Promise<void> {
  const wrapped = wrapTurnApplicationStream(
    (async function* () {
      yield* events;
    })(),
    registry,
    { now },
  );
  for await (const yielded of wrapped) void yielded;
}

describe('wrapTurnApplicationStream（Q04）', () => {
  it('指标实现抛错时仍原样透传 Turn 事件', async () => {
    const events = [
      event('turn.started', {
        userMessageId: 'u1',
        assistantMessageId: 'a1',
        replayed: false,
      }),
      event('message.delta', { messageId: 'a1', delta: 'hi' }),
      event('turn.completed', { messageId: 'a1' }),
    ];
    const seen: string[] = [];
    const throwingMetrics = {
      increment() {
        throw new Error('metrics unavailable');
      },
      record() {
        throw new Error('metrics unavailable');
      },
      set() {
        throw new Error('metrics unavailable');
      },
      snapshot: () => ({ counters: {}, histograms: {}, gauges: {} }),
    };
    for await (const yielded of wrapTurnApplicationStream(
      (async function* () {
        yield* events;
      })(),
      throwingMetrics,
    )) {
      seen.push(yielded.type);
    }
    expect(seen).toEqual(['turn.started', 'message.delta', 'turn.completed']);
  });

  it('事件原样透传（不改变 Turn 语义）', async () => {
    const registry = new MetricsRegistry();
    const events: TurnApplicationEvent[] = [
      event('turn.started', {
        userMessageId: 'u1',
        assistantMessageId: 'a1',
        replayed: false,
      }),
      event('message.delta', { messageId: 'a1', delta: 'hi' }),
      event('turn.completed', { messageId: 'a1' }),
    ];
    const seen: string[] = [];
    for await (const yielded of wrapTurnApplicationStream(
      (async function* () {
        yield* events;
      })(),
      registry,
    )) {
      seen.push(yielded.type);
    }
    expect(seen).toEqual(['turn.started', 'message.delta', 'turn.completed']);
  });

  it('TTFT = started 到首个 delta；total = started 到终态', async () => {
    const registry = new MetricsRegistry();
    // 按调用顺序脚本化时钟：started=100，delta=500（TTFT 400），completed=700（total 600）。
    const times = [100, 500, 700];
    let index = 0;
    const now = () => times[Math.min(index++, times.length - 1)]!;
    await collect(
      registry,
      [
        event('turn.started', {
          userMessageId: 'u1',
          assistantMessageId: 'a1',
          replayed: false,
        }),
        event('message.delta', { messageId: 'a1', delta: 'a' }),
        event('turn.completed', { messageId: 'a1' }),
      ],
      now,
    );
    const histogram = registry.snapshot().histograms;
    expect(histogram['turn_ttft_ms']!.sum).toBe(400);
    expect(histogram['turn_total_ms']!.sum).toBe(600);
  });

  it('completed/failed/cancelled 分别计数 outcome', async () => {
    const registry = new MetricsRegistry();
    for (const type of [
      'turn.completed',
      'turn.failed',
      'turn.cancelled',
    ] as const) {
      await collect(
        registry,
        [
          event('turn.started', {
            userMessageId: 'u',
            assistantMessageId: 'a',
            replayed: false,
          }),
          event(type, { messageId: 'a' }),
        ],
        () => 0,
      );
    }
    const counters = registry.snapshot().counters;
    expect(counters['turn_completed_total{outcome=completed}']).toBe(1);
    expect(counters['turn_completed_total{outcome=failed}']).toBe(1);
    expect(counters['turn_completed_total{outcome=cancelled}']).toBe(1);
  });

  it('MODEL_FAILED 的 turn.failed 记入 turn_model_failed_total', async () => {
    const registry = new MetricsRegistry();
    await collect(
      registry,
      [
        event('turn.started', {
          userMessageId: 'u',
          assistantMessageId: 'a',
          replayed: false,
        }),
        event('turn.failed', {
          messageId: 'a',
          code: 'MODEL_FAILED',
          retryable: true,
        }),
      ],
      () => 0,
    );
    const counters = registry.snapshot().counters;
    expect(counters['turn_model_failed_total']).toBe(1);
  });

  it('工具延迟与失败码计数；未配对 started 不产生延迟', async () => {
    const registry = new MetricsRegistry();
    let clock = 0;
    await collect(
      registry,
      [
        event('turn.started', {
          userMessageId: 'u',
          assistantMessageId: 'a',
          replayed: false,
        }),
        event('tool.started', { toolCallId: 't1', tool: 'search' }),
        event('tool.failed', {
          toolCallId: 't1',
          code: 'TOOL_FAILED',
          retryable: false,
        }),
        event('tool.completed', { toolCallId: 'missing' }),
        event('turn.cancelled', { messageId: 'a' }),
      ],
      () => {
        clock += 250;
        return clock;
      },
    );
    const snapshot = registry.snapshot();
    expect(snapshot.histograms['turn_tool_latency_ms']!.sum).toBe(250);
    expect(snapshot.counters['turn_tool_failure_total{code=TOOL_FAILED}']).toBe(
      1,
    );
    // 工具均已结算：不产生 outcome_unknown。
    expect(
      snapshot.counters['turn_tool_outcome_unknown_total'],
    ).toBeUndefined();
  });

  it('流结束仍未结算的工具调用记入 outcome_unknown（与账本同语义，一次计数）', async () => {
    const registry = new MetricsRegistry();
    await collect(
      registry,
      [
        event('turn.started', {
          userMessageId: 'u',
          assistantMessageId: 'a',
          replayed: false,
        }),
        event('tool.started', { toolCallId: 't1', tool: 'search' }),
        event('tool.started', { toolCallId: 't2', tool: 'search' }),
        event('tool.completed', { toolCallId: 't1' }),
        event('turn.cancelled', { messageId: 'a' }),
      ],
      () => 0,
    );
    const counters = registry.snapshot().counters;
    expect(counters['turn_tool_outcome_unknown_total']).toBe(1);
    expect(counters['turn_completed_total{outcome=cancelled}']).toBe(1);
  });

  it('artifact.failed 事件计入 Artifact 生成失败 SLI', async () => {
    const registry = new MetricsRegistry();
    await collect(
      registry,
      [
        event('turn.started', {
          userMessageId: 'u',
          assistantMessageId: 'a',
          replayed: false,
        }),
        event('artifact.proposed', { artifactId: 'art-1', kind: 'note' }),
        event('artifact.failed', { artifactId: 'art-1', code: 'TOOL_FAILED' }),
        event('turn.completed', { messageId: 'a' }),
      ],
      () => 0,
    );
    const counters = registry.snapshot().counters;
    expect(counters['artifact_generation_failed_total']).toBe(1);
  });

  it('不记录任何敏感字段（快照只有低基数点键）', async () => {
    const registry = new MetricsRegistry();
    await collect(
      registry,
      [
        event('turn.started', {
          userMessageId: 'u',
          assistantMessageId: 'a',
          replayed: false,
        }),
        event('message.delta', { messageId: 'a', delta: '学生隐私正文' }),
        event('turn.completed', { messageId: 'a' }),
      ],
      () => 0,
    );
    const serialized = JSON.stringify(registry.snapshot());
    expect(serialized).not.toContain('学生隐私正文');
    expect(serialized).not.toContain('u1');
  });
});
