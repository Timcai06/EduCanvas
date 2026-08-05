import { describe, expect, it } from 'vitest';
import {
  StreamingTranscriptionStateError,
  type StreamingTranscriptionPcmChunk,
} from './streaming-transcription-contracts';
import {
  STREAMING_TRANSCRIPTION_TAIL_SILENCE_BYTES,
  STREAMING_TRANSCRIPTION_TAIL_SILENCE_SECONDS,
  applyStreamingTranscriptionCancel,
  applyStreamingTranscriptionChunk,
  applyStreamingTranscriptionEndpoint,
  applyStreamingTranscriptionFinish,
  createStreamingSegmentationSnapshot,
  type StreamingSegmentationSnapshot,
} from './streaming-transcription-segmentation-policy';

const chunk = (
  sequence: number,
  byteLength: number,
  overrides: Partial<StreamingTranscriptionPcmChunk> = {},
): StreamingTranscriptionPcmChunk => ({
  operationId: 'operation:1',
  segmentId: 'segment:1',
  sequence,
  sampleRate: 16_000,
  channels: 1,
  encoding: 'pcm_s16le',
  pcmBytes: new Uint8Array(byteLength),
  ...overrides,
});

type InputAction =
  | { type: 'chunk'; byteLength: number }
  | { type: 'endpoint' }
  | { type: 'finish' }
  | { type: 'cancel' };

const op = (): StreamingSegmentationSnapshot =>
  createStreamingSegmentationSnapshot('operation:1', 'segment:1');

const applyAll = (
  snapshot: StreamingSegmentationSnapshot,
  actions: readonly InputAction[],
): StreamingSegmentationSnapshot => {
  let current = snapshot;
  for (const action of actions) {
    switch (action.type) {
      case 'chunk':
        current = applyStreamingTranscriptionChunk(
          current,
          chunk(current.sequence + 1, action.byteLength),
        );
        break;
      case 'endpoint':
        current = applyStreamingTranscriptionEndpoint(current);
        break;
      case 'finish':
        current = applyStreamingTranscriptionFinish(current);
        break;
      case 'cancel':
        current = applyStreamingTranscriptionCancel(current);
        break;
    }
  }
  return current;
};

const expectRejected = (run: () => unknown, code: string): void => {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(StreamingTranscriptionStateError);
  expect((caught as StreamingTranscriptionStateError).code).toBe(code);
};

describe('任意合法 chunk 边界等价', () => {
  it.each([
    { name: '3 × 16 000', boundaries: [16_000, 16_000, 8_000] },
    { name: '32 000 + 8 000', boundaries: [32_000, 8_000] },
    { name: '16 000 + 24 000', boundaries: [16_000, 24_000] },
    { name: '8 000 × 5', boundaries: [8_000, 8_000, 8_000, 8_000, 8_000] },
  ])('$name 与基准分片得到相同总字节数与尾部描述', ({ boundaries }) => {
    const baseline = applyAll(op(), [
      { type: 'chunk', byteLength: 20_000 },
      { type: 'chunk', byteLength: 20_000 },
      { type: 'finish' },
    ]);
    const variant = applyAll(
      op(),
      boundaries.map((byteLength) => ({
        type: 'chunk' as const,
        byteLength,
      })),
    );
    const finished = applyStreamingTranscriptionFinish(variant);
    expect(finished.inputBytes).toBe(baseline.inputBytes);
    expect(finished.totalBytes).toBe(baseline.totalBytes);
    expect(finished.tailChunks).toEqual(baseline.tailChunks);
    expect(finished.phase).toBe('finished');
  });
});

describe('finish 尾部 flush', () => {
  it('空输入 finish：尾部 48 000 字节、总字节 48 000', () => {
    const snapshot = applyStreamingTranscriptionFinish(op());
    expect(snapshot.phase).toBe('finished');
    expect(snapshot.inputBytes).toBe(0);
    expect(snapshot.totalBytes).toBe(
      STREAMING_TRANSCRIPTION_TAIL_SILENCE_BYTES,
    );
    expect(snapshot.tailChunks.map((tail) => tail.byteLength)).toEqual([
      32_000, 16_000,
    ]);
  });

  it('有输入 finish：输入字节 + 尾部字节', () => {
    const snapshot = applyAll(op(), [
      { type: 'chunk', byteLength: 16_000 },
      { type: 'chunk', byteLength: 16_000 },
      { type: 'finish' },
    ]);
    expect(snapshot.inputBytes).toBe(32_000);
    expect(snapshot.totalBytes).toBe(32_000 + 48_000);
    expect(snapshot.phase).toBe('finished');
  });

  it('1.5 秒尾部字节数精确：48 000 = 1.5 × 16 000 × 1 × 2', () => {
    expect(STREAMING_TRANSCRIPTION_TAIL_SILENCE_SECONDS).toBe(1.5);
    expect(STREAMING_TRANSCRIPTION_TAIL_SILENCE_BYTES).toBe(48_000);
    const tailChunks = applyStreamingTranscriptionFinish(op()).tailChunks;
    // 每块都是合法描述：偶数、非空、不超单分片上限。
    for (const [index, tail] of tailChunks.entries()) {
      expect(tail.sequence).toBe(index);
      expect(tail.byteLength).toBeGreaterThan(0);
      expect(tail.byteLength % 2).toBe(0);
      expect(tail.byteLength).toBeLessThanOrEqual(32_000);
      expect(tail.sampleRate).toBe(16_000);
      expect(tail.channels).toBe(1);
      expect(tail.encoding).toBe('pcm_s16le');
      expect(tail.isZero).toBe(true);
    }
    expect(tailChunks.reduce((sum, tail) => sum + tail.byteLength, 0)).toBe(
      48_000,
    );
  });

  it('endpoint 后 finish 仍生成尾部（endpoint 只是锁输入，flush 在 finish）', () => {
    const snapshot = applyAll(op(), [
      { type: 'chunk', byteLength: 16_000 },
      { type: 'endpoint' },
      { type: 'finish' },
    ]);
    expect(snapshot.phase).toBe('finished');
    expect(snapshot.inputBytes).toBe(16_000);
    expect(snapshot.totalBytes).toBe(16_000 + 48_000);
    expect(snapshot.tailChunks.map((tail) => tail.byteLength)).toEqual([
      32_000, 16_000,
    ]);
  });
});

describe('endpoint / finish / cancel 后拒绝新分片', () => {
  it('endpoint 后 pushChunk → INPUT_AFTER_ENDPOINT', () => {
    const snapshot = applyStreamingTranscriptionEndpoint(op());
    expectRejected(
      () => applyStreamingTranscriptionChunk(snapshot, chunk(0, 16_000)),
      'INPUT_AFTER_ENDPOINT',
    );
  });

  it('finish 后 pushChunk → INPUT_AFTER_FINISH', () => {
    const snapshot = applyStreamingTranscriptionFinish(op());
    expectRejected(
      () => applyStreamingTranscriptionChunk(snapshot, chunk(0, 16_000)),
      'INPUT_AFTER_FINISH',
    );
  });

  it('cancel 后 pushChunk → INPUT_AFTER_TERMINAL', () => {
    const snapshot = applyStreamingTranscriptionCancel(op());
    expectRejected(
      () => applyStreamingTranscriptionChunk(snapshot, chunk(0, 16_000)),
      'INPUT_AFTER_TERMINAL',
    );
  });
});

describe('重复动作稳定错误', () => {
  it('重复 finish → INPUT_AFTER_FINISH', () => {
    const snapshot = applyStreamingTranscriptionFinish(op());
    expectRejected(
      () => applyStreamingTranscriptionFinish(snapshot),
      'INPUT_AFTER_FINISH',
    );
  });

  it('重复 cancel → INPUT_AFTER_TERMINAL', () => {
    const snapshot = applyStreamingTranscriptionCancel(op());
    expectRejected(
      () => applyStreamingTranscriptionCancel(snapshot),
      'INPUT_AFTER_TERMINAL',
    );
  });

  it('重复 endpoint → INPUT_AFTER_ENDPOINT', () => {
    const snapshot = applyStreamingTranscriptionEndpoint(op());
    expectRejected(
      () => applyStreamingTranscriptionEndpoint(snapshot),
      'INPUT_AFTER_ENDPOINT',
    );
  });

  it('finish 后 cancel / cancel 后 finish 都拒绝', () => {
    expectRejected(
      () =>
        applyStreamingTranscriptionCancel(
          applyStreamingTranscriptionFinish(op()),
        ),
      'INPUT_AFTER_TERMINAL',
    );
    expectRejected(
      () =>
        applyStreamingTranscriptionFinish(
          applyStreamingTranscriptionCancel(op()),
        ),
      'INPUT_AFTER_TERMINAL',
    );
  });

  it('finish 后 endpoint 拒绝', () => {
    expectRejected(
      () =>
        applyStreamingTranscriptionEndpoint(
          applyStreamingTranscriptionFinish(op()),
        ),
      'INPUT_AFTER_FINISH',
    );
  });
});

describe('cancel 不生成尾部静音', () => {
  it('open 直接 cancel：tailChunks 为空、totalBytes 保持 inputBytes', () => {
    const snapshot = applyStreamingTranscriptionCancel(op());
    expect(snapshot.phase).toBe('cancelled');
    expect(snapshot.tailChunks).toEqual([]);
    expect(snapshot.totalBytes).toBe(0);
  });

  it('有输入后 cancel：不补尾部、已累计字节保留', () => {
    const snapshot = applyAll(op(), [
      { type: 'chunk', byteLength: 16_000 },
      { type: 'chunk', byteLength: 8_000 },
      { type: 'cancel' },
    ]);
    expect(snapshot.phase).toBe('cancelled');
    expect(snapshot.inputBytes).toBe(24_000);
    expect(snapshot.totalBytes).toBe(24_000);
    expect(snapshot.tailChunks).toEqual([]);
  });

  it('endpoint 后 cancel：同样不生成尾部', () => {
    const snapshot = applyAll(op(), [
      { type: 'chunk', byteLength: 16_000 },
      { type: 'endpoint' },
      { type: 'cancel' },
    ]);
    expect(snapshot.phase).toBe('cancelled');
    expect(snapshot.tailChunks).toEqual([]);
    expect(snapshot.totalBytes).toBe(16_000);
  });
});

describe('sequence 与归属结构违规（UNKNOWN 稳定兜底）', () => {
  it('重复 sequence 被拒绝', () => {
    const snapshot = applyStreamingTranscriptionChunk(op(), chunk(0, 16_000));
    expectRejected(
      () => applyStreamingTranscriptionChunk(snapshot, chunk(0, 16_000)),
      'UNKNOWN',
    );
  });

  it('跳号被拒绝', () => {
    expectRejected(
      () => applyStreamingTranscriptionChunk(op(), chunk(2, 16_000)),
      'UNKNOWN',
    );
    const snapshot = applyStreamingTranscriptionChunk(op(), chunk(0, 16_000));
    expectRejected(
      () => applyStreamingTranscriptionChunk(snapshot, chunk(2, 16_000)),
      'UNKNOWN',
    );
  });

  it('倒序（旧 sequence 新内容）被拒绝', () => {
    const snapshot = applyAll(op(), [
      { type: 'chunk', byteLength: 16_000 },
      { type: 'chunk', byteLength: 16_000 },
    ]);
    expectRejected(
      () => applyStreamingTranscriptionChunk(snapshot, chunk(0, 8_000)),
      'UNKNOWN',
    );
  });

  it('错误 segmentId 被拒绝', () => {
    const snapshot = op();
    expectRejected(
      () =>
        applyStreamingTranscriptionChunk(
          snapshot,
          chunk(0, 16_000, { segmentId: 'segment:other' }),
        ),
      'UNKNOWN',
    );
  });

  it('跨 operation 被拒绝', () => {
    const snapshot = op();
    expectRejected(
      () =>
        applyStreamingTranscriptionChunk(
          snapshot,
          chunk(0, 16_000, { operationId: 'operation:other' }),
        ),
      'UNKNOWN',
    );
  });
});

describe('不可变性与纯净性', () => {
  it('输入 snapshot 与 chunk 不被修改（深冻结后仍可累计）', () => {
    const snapshot = applyStreamingTranscriptionChunk(op(), chunk(0, 16_000));
    const deepFreeze = <T>(value: T): T => {
      // typed array（如 chunk.pcmBytes）不能被 Object.freeze 冻结，且本策略
      // 只读取其 length，跳过即可证明"输入不被修改"。
      if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
        for (const key of Object.keys(value as object)) {
          deepFreeze((value as Record<string, unknown>)[key]);
        }
        Object.freeze(value);
      }
      return value;
    };
    const frozenSnapshot = deepFreeze(structuredClone(snapshot));
    const frozenChunk = deepFreeze(structuredClone(chunk(1, 8_000)));

    const next = applyStreamingTranscriptionChunk(frozenSnapshot, frozenChunk);
    expect(next.inputBytes).toBe(24_000);
    expect(next.sequence).toBe(1);
    // 原快照保持不变。
    expect(frozenSnapshot.inputBytes).toBe(16_000);
    expect(frozenSnapshot.sequence).toBe(0);
  });

  it('快照不携带 PCM 或敏感字段', () => {
    const snapshot = applyStreamingTranscriptionFinish(
      applyStreamingTranscriptionChunk(op(), chunk(0, 16_000)),
    );
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

describe('确定性', () => {
  it('相同动作序列两次独立重放得到深度相等快照', () => {
    const actions: readonly InputAction[] = [
      { type: 'chunk', byteLength: 16_000 },
      { type: 'chunk', byteLength: 8_000 },
      { type: 'endpoint' },
      { type: 'finish' },
    ];
    const first = applyAll(op(), actions);
    const second = applyAll(op(), actions);
    expect(second).toEqual(first);
    expect(first.tailChunks).toEqual(second.tailChunks);
  });

  it('相同输入 chunk 序列累计结果一致', () => {
    const run = (): StreamingSegmentationSnapshot => {
      let snapshot = op();
      for (let index = 0; index < 3; index += 1) {
        snapshot = applyStreamingTranscriptionChunk(
          snapshot,
          chunk(index, 10_000),
        );
      }
      return applyStreamingTranscriptionFinish(snapshot);
    };
    expect(run()).toEqual(run());
  });
});
