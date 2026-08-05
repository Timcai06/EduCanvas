import { describe, expect, it } from 'vitest';
import {
  StreamingTranscriptionStateError,
  streamingTranscriptionProtocolVersion,
  type StreamingTranscriptionEvent,
} from './streaming-transcription-contracts';
import {
  applyStreamingTranscriptionEvent,
  createStreamingTranscriptionSnapshot,
  type StreamingTranscriptionSnapshot,
} from './streaming-transcription-reducer';

const eventBase = {
  protocolVersion: streamingTranscriptionProtocolVersion,
  operationId: 'operation:1',
  segmentId: 'segment:1',
} as const;

const event = <T extends StreamingTranscriptionEvent>(value: T): T => value;
const partial = (segmentId: string, sequence: number, text: string) =>
  event({ ...eventBase, segmentId, type: 'partial', sequence, text });
const endpoint = (segmentId: string, sequence: number) =>
  event({ ...eventBase, segmentId, type: 'endpoint', sequence });
const finalEvent = (segmentId: string, sequence: number, text: string) =>
  event({ ...eventBase, segmentId, type: 'final', sequence, text });
const failed = (
  segmentId: string,
  sequence: number,
  failureCode: string = 'MODEL_FAILED',
) =>
  event({
    ...eventBase,
    segmentId,
    type: 'failed',
    sequence,
    failureCode,
  } as StreamingTranscriptionEvent);

const op = (operationId: string): StreamingTranscriptionSnapshot =>
  createStreamingTranscriptionSnapshot(operationId);

const applyAll = (
  snapshot: StreamingTranscriptionSnapshot,
  events: readonly StreamingTranscriptionEvent[],
): StreamingTranscriptionSnapshot => {
  let current = snapshot;
  for (const item of events) {
    current = applyStreamingTranscriptionEvent(current, item);
  }
  return current;
};

const expectRejected = (
  snapshot: StreamingTranscriptionSnapshot,
  item: StreamingTranscriptionEvent,
  code: string,
): void => {
  let caught: unknown;
  try {
    applyStreamingTranscriptionEvent(snapshot, item);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(StreamingTranscriptionStateError);
  expect((caught as StreamingTranscriptionStateError).code).toBe(code);
};

describe('partial 新增、连续修正与 final 收口（表驱动）', () => {
  it.each([
    {
      name: '空快照上 partial 新增',
      events: [partial('segment:1', 0, '你好')],
      combinedText: '你好',
      status: 'active',
      text: '你好',
    },
    {
      name: '连续修正替换旧假设',
      events: [
        partial('segment:1', 0, '你好'),
        partial('segment:1', 1, '你好世界'),
      ],
      combinedText: '你好世界',
      status: 'active',
      text: '你好世界',
    },
    {
      name: 'final 收口替换 partial 并锁定',
      events: [
        partial('segment:1', 0, '你好'),
        finalEvent('segment:1', 1, '你好世界'),
      ],
      combinedText: '你好世界',
      status: 'final',
      text: '你好世界',
    },
    {
      name: 'endpoint 后 final 收口',
      events: [
        partial('segment:1', 0, '你好'),
        endpoint('segment:1', 1),
        finalEvent('segment:1', 2, '你好世界'),
      ],
      combinedText: '你好世界',
      status: 'final',
      text: '你好世界',
    },
  ])('$name', ({ events, combinedText, status, text }) => {
    const snapshot = applyAll(op('operation:1'), events);
    expect(snapshot.combinedText).toBe(combinedText);
    expect(snapshot.segments).toHaveLength(1);
    const segment = snapshot.segments[0] as NonNullable<
      (typeof snapshot.segments)[number]
    >;
    expect(segment.status).toBe(status);
    expect(segment.text).toBe(text);
    expect(segment.segmentId).toBe('segment:1');
  });
});

describe('多 segment 严格隔离与组合顺序', () => {
  it('两个 segment 各自计数、文本不串', () => {
    const snapshot = applyAll(op('operation:1'), [
      partial('segment:1', 0, '老师'),
      partial('segment:2', 0, '贝叶斯'),
      partial('segment:1', 1, '老师你好'),
      finalEvent('segment:1', 2, '老师你好'),
      partial('segment:2', 1, '贝叶斯定理'),
    ]);
    expect(snapshot.segments.map((segment) => segment.segmentId)).toEqual([
      'segment:1',
      'segment:2',
    ]);
    const first = snapshot.segments[0] as NonNullable<
      (typeof snapshot.segments)[number]
    >;
    const second = snapshot.segments[1] as NonNullable<
      (typeof snapshot.segments)[number]
    >;
    expect(first.status).toBe('final');
    expect(first.text).toBe('老师你好');
    expect(second.status).toBe('active');
    expect(second.text).toBe('贝叶斯定理');
    // 组合文本按首次出现顺序拼接，且 final 不覆盖其他 segment。
    expect(snapshot.combinedText).toBe('老师你好贝叶斯定理');
  });

  it('一个 segment 终态后，另一个 segment 仍可继续', () => {
    const snapshot = applyAll(op('operation:1'), [
      finalEvent('segment:1', 0, '第一段'),
      partial('segment:2', 0, '第二段'),
      finalEvent('segment:2', 1, '第二段终稿'),
    ]);
    expect(snapshot.combinedText).toBe('第一段第二段终稿');
    expect(
      (snapshot.segments[1] as NonNullable<(typeof snapshot.segments)[number]>)
        .status,
    ).toBe('final');
  });

  it('endpoint 只影响本 segment，不阻塞其他 segment 的 partial', () => {
    const snapshot = applyAll(op('operation:1'), [
      endpoint('segment:1', 0),
      partial('segment:2', 0, '第二段'),
    ]);
    expect(snapshot.combinedText).toBe('第二段');
  });
});

describe('重复事件幂等', () => {
  it('相同事件序列独立重放得到深度相等快照，末事件幂等重放返回原引用', () => {
    const events = [
      partial('segment:1', 0, '你好'),
      partial('segment:1', 1, '你好世界'),
      endpoint('segment:1', 2),
      finalEvent('segment:1', 3, '你好世界终稿'),
    ];
    const first = applyAll(op('operation:1'), events);
    // 相同序列从头重放（新快照）必须得到深度相等结果。
    const second = applyAll(op('operation:1'), events);
    expect(second).toEqual(first);
    // 幂等重放不产生新对象（final 已在快照中，同 sequence 同 payload）。
    const replayed = applyStreamingTranscriptionEvent(
      first,
      events[3] as StreamingTranscriptionEvent,
    );
    expect(replayed).toBe(first);
    // 终态后重放 final 之前的旧事件（非幂等）属于终态后输入，报 INPUT_AFTER_TERMINAL。
    expectRejected(
      first,
      events[0] as StreamingTranscriptionEvent,
      'INPUT_AFTER_TERMINAL',
    );
  });

  it('partial/final/endpoint/failed 各自幂等', () => {
    const snapshot = applyAll(op('operation:1'), [
      partial('segment:1', 0, '你好'),
      endpoint('segment:1', 1),
      finalEvent('segment:1', 2, '终稿'),
    ]);
    expect(
      applyStreamingTranscriptionEvent(
        snapshot,
        finalEvent('segment:1', 2, '终稿'),
      ),
    ).toBe(snapshot);

    // endpoint 同号幂等重放返回原快照。
    const endpointSnapshot = applyStreamingTranscriptionEvent(
      op('operation:1'),
      endpoint('segment:1', 0),
    );
    expect(
      applyStreamingTranscriptionEvent(
        endpointSnapshot,
        endpoint('segment:1', 0),
      ),
    ).toBe(endpointSnapshot);

    const failedSnapshot = applyStreamingTranscriptionEvent(
      op('operation:1'),
      failed('segment:1', 0, 'CANCELLED'),
    );
    expect(
      applyStreamingTranscriptionEvent(
        failedSnapshot,
        failed('segment:1', 0, 'CANCELLED'),
      ),
    ).toBe(failedSnapshot);
    // failed 后换不同失败码不是幂等重放，属于终态后输入。
    expectRejected(
      failedSnapshot,
      failed('segment:1', 0, 'MODEL_FAILED'),
      'INPUT_AFTER_TERMINAL',
    );
  });
});

describe('sequence 结构违规（UNKNOWN 稳定兜底）', () => {
  it('跳号被拒绝', () => {
    expectRejected(
      op('operation:1'),
      partial('segment:1', 2, '跳号'),
      'UNKNOWN',
    );
    const snapshot = applyStreamingTranscriptionEvent(
      op('operation:1'),
      partial('segment:1', 0, '你好'),
    );
    expectRejected(snapshot, partial('segment:1', 2, '跳过'), 'UNKNOWN');
  });

  it('倒序（旧 sequence 新内容）被拒绝', () => {
    const snapshot = applyAll(op('operation:1'), [
      partial('segment:1', 0, '第一'),
      partial('segment:1', 1, '第二'),
    ]);
    expectRejected(snapshot, partial('segment:1', 0, '篡改第一'), 'UNKNOWN');
  });

  it('同 sequence 不同内容被拒绝', () => {
    const snapshot = applyStreamingTranscriptionEvent(
      op('operation:1'),
      partial('segment:1', 0, '你好'),
    );
    expectRejected(snapshot, partial('segment:1', 0, '篡改'), 'UNKNOWN');
  });

  it('同 sequence 不同类型不是幂等重放（partial 后同号 final 拒绝）', () => {
    const snapshot = applyStreamingTranscriptionEvent(
      op('operation:1'),
      partial('segment:1', 0, '你好'),
    );
    expectRejected(snapshot, finalEvent('segment:1', 0, '你好'), 'UNKNOWN');
  });

  it('新 segment 首事件 sequence 不为 0 被拒绝', () => {
    expectRejected(
      op('operation:1'),
      partial('segment:9', 3, '乱序'),
      'UNKNOWN',
    );
  });
});

describe('跨 operation 拒绝', () => {
  it('其他 operation 的事件一律拒绝', () => {
    const snapshot = op('operation:1');
    const cross = {
      ...eventBase,
      operationId: 'operation:2',
      segmentId: 'segment:1',
      type: 'partial',
      sequence: 0,
      text: '越权',
    } as StreamingTranscriptionEvent;
    expectRejected(snapshot, cross, 'UNKNOWN');
  });
});

describe('endpoint 语义', () => {
  it('endpoint 后 partial 拒绝（INPUT_AFTER_ENDPOINT）', () => {
    const snapshot = applyStreamingTranscriptionEvent(
      op('operation:1'),
      endpoint('segment:1', 0),
    );
    expectRejected(
      snapshot,
      partial('segment:1', 1, '端点后'),
      'INPUT_AFTER_ENDPOINT',
    );
  });

  it('重复 endpoint 拒绝（endpoint 已确立）', () => {
    const snapshot = applyStreamingTranscriptionEvent(
      op('operation:1'),
      endpoint('segment:1', 0),
    );
    expectRejected(snapshot, endpoint('segment:1', 1), 'INPUT_AFTER_ENDPOINT');
  });
});

describe('final 后拒绝（INPUT_AFTER_TERMINAL）', () => {
  const finalSnapshot = (): StreamingTranscriptionSnapshot =>
    applyAll(op('operation:1'), [
      partial('segment:1', 0, '你好'),
      finalEvent('segment:1', 1, '你好世界'),
    ]);

  it('final 后 partial 拒绝', () => {
    expectRejected(
      finalSnapshot(),
      partial('segment:1', 2, '晚到'),
      'INPUT_AFTER_TERMINAL',
    );
  });

  it('final 后新的 final 拒绝', () => {
    expectRejected(
      finalSnapshot(),
      finalEvent('segment:1', 2, '另一个终稿'),
      'INPUT_AFTER_TERMINAL',
    );
  });

  it('final 后旧 sequence 的 partial 重放也拒绝（非幂等）', () => {
    expectRejected(
      finalSnapshot(),
      partial('segment:1', 0, '你好'),
      'INPUT_AFTER_TERMINAL',
    );
  });
});

describe('failed 终态与 cancelled', () => {
  it('failed 终态：状态 failed、文本不投影、组合文本跳过', () => {
    const snapshot = applyAll(op('operation:1'), [
      partial('segment:1', 0, '你好'),
      failed('segment:1', 1, 'MODEL_FAILED'),
    ]);
    const segment = snapshot.segments[0] as NonNullable<
      (typeof snapshot.segments)[number]
    >;
    expect(segment.status).toBe('failed');
    expect(segment.text).toBe('');
    expect(segment.failureCode).toBe('MODEL_FAILED');
    expect(snapshot.combinedText).toBe('');
  });

  it('cancelled 以 failed + CANCELLED 表达', () => {
    const snapshot = applyStreamingTranscriptionEvent(
      op('operation:1'),
      failed('segment:1', 0, 'CANCELLED'),
    );
    const segment = snapshot.segments[0] as NonNullable<
      (typeof snapshot.segments)[number]
    >;
    expect(segment.status).toBe('failed');
    expect(segment.failureCode).toBe('CANCELLED');
    expect(snapshot.combinedText).toBe('');
  });

  it('failed 后继续事件拒绝（INPUT_AFTER_TERMINAL）', () => {
    const snapshot = applyStreamingTranscriptionEvent(
      op('operation:1'),
      failed('segment:1', 0, 'MODEL_FAILED'),
    );
    expectRejected(
      snapshot,
      partial('segment:1', 1, '失败后'),
      'INPUT_AFTER_TERMINAL',
    );
  });

  it('一个 segment failed 不阻塞其他 segment', () => {
    const snapshot = applyAll(op('operation:1'), [
      failed('segment:1', 0, 'MODEL_FAILED'),
      partial('segment:2', 0, '正常段'),
      finalEvent('segment:2', 1, '正常段终稿'),
    ]);
    expect(snapshot.combinedText).toBe('正常段终稿');
  });
});

describe('不可变性与纯净性', () => {
  it('输入 snapshot 与 event 不被修改（深冻结后仍可归并）', () => {
    const snapshot = applyStreamingTranscriptionEvent(
      op('operation:1'),
      partial('segment:1', 0, '你好'),
    );
    const frozenSnapshot = structuredClone(snapshot);
    const deepFreeze = <T>(value: T): T => {
      if (value && typeof value === 'object') {
        for (const key of Object.keys(value as object)) {
          deepFreeze((value as Record<string, unknown>)[key]);
        }
        Object.freeze(value);
      }
      return value;
    };
    deepFreeze(frozenSnapshot);
    const frozenEvent = deepFreeze(partial('segment:1', 1, '你好世界'));

    const next = applyStreamingTranscriptionEvent(frozenSnapshot, frozenEvent);
    expect(next.combinedText).toBe('你好世界');
    // 原快照保持不变。
    expect(frozenSnapshot.segments).toHaveLength(1);
    expect(
      (
        frozenSnapshot.segments[0] as NonNullable<
          (typeof frozenSnapshot.segments)[number]
        >
      ).text,
    ).toBe('你好');
  });

  it('快照不包含 PCM、Provider、Prompt、Secret 或 stack', () => {
    const snapshot = applyAll(op('operation:1'), [
      partial('segment:1', 0, '你好'),
      finalEvent('segment:1', 1, '你好世界'),
      failed('segment:2', 0, 'CANCELLED'),
    ]);
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of [
      'pcmBytes',
      'PCM',
      'provider',
      'Provider',
      'prompt',
      'Prompt',
      'apiKey',
      'secret',
      'stack',
      'modelPath',
      'audioBytes',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
