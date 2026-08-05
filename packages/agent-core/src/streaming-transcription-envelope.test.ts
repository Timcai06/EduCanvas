import { describe, expect, it } from 'vitest';
import {
  MAX_PCM_CHUNK_BYTES,
  streamingTranscriptionProtocolVersion,
} from './streaming-transcription-contracts';
import {
  streamingTranscriptionClientMessageSchema,
  streamingTranscriptionServerMessageSchema,
  validateStreamingTranscriptionClientMessageSequence,
  validateStreamingTranscriptionServerMessageSequence,
  type StreamingTranscriptionClientMessage,
  type StreamingTranscriptionServerMessage,
} from './streaming-transcription-envelope';

const base = {
  protocolVersion: streamingTranscriptionProtocolVersion,
  operationId: 'operation:1',
  segmentId: 'segment:1',
} as const;

const startMessage = (
  overrides: Record<string, unknown> = {},
): StreamingTranscriptionClientMessage =>
  ({
    ...base,
    type: 'start',
    sequence: 0,
    sampleRate: 16_000,
    channels: 1,
    encoding: 'pcm_s16le',
    ...overrides,
  }) as StreamingTranscriptionClientMessage;

const chunkMessage = (
  sequence: number,
  overrides: Record<string, unknown> = {},
): StreamingTranscriptionClientMessage =>
  ({
    ...base,
    type: 'chunk',
    sequence,
    sampleRate: 16_000,
    channels: 1,
    encoding: 'pcm_s16le',
    pcmBytes: new Uint8Array([0x00, 0x00]),
    ...overrides,
  }) as StreamingTranscriptionClientMessage;

const finishMessage = (sequence: number): StreamingTranscriptionClientMessage =>
  ({
    ...base,
    type: 'finish',
    sequence,
  }) as StreamingTranscriptionClientMessage;

const cancelMessage = (sequence: number): StreamingTranscriptionClientMessage =>
  ({
    ...base,
    type: 'cancel',
    sequence,
  }) as StreamingTranscriptionClientMessage;

/** server 事件构造（与 V04 测试同构）。 */
const event = <T extends StreamingTranscriptionServerMessage>(value: T): T =>
  value;
const serverPartial = (sequence: number, text = '你好') =>
  event({ ...base, type: 'partial', sequence, text });
const serverEndpoint = (sequence: number) =>
  event({ ...base, type: 'endpoint', sequence });
const serverFinal = (sequence: number, text = '你好世界') =>
  event({ ...base, type: 'final', sequence, text });
const serverFailed = (sequence: number, failureCode = 'MODEL_FAILED') =>
  event({
    ...base,
    type: 'failed',
    sequence,
    failureCode,
  } as StreamingTranscriptionServerMessage);

/** 断言 parse 失败，且错误序列化结果不含任何敏感令牌。 */
function expectRejectedWithoutLeak(
  input: unknown,
  forbiddenTokens: readonly string[],
): void {
  const result = streamingTranscriptionClientMessageSchema.safeParse(input);
  expect(result.success).toBe(false);
  const serialized = JSON.stringify(result.error);
  for (const token of forbiddenTokens) {
    expect(serialized, `错误结果泄漏了敏感内容：${token}`).not.toContain(token);
  }
}

describe('client envelope Schema（start/chunk/finish/cancel）', () => {
  it('接受四类合法消息', () => {
    expect(
      streamingTranscriptionClientMessageSchema.parse(startMessage()),
    ).toEqual(startMessage());
    expect(
      streamingTranscriptionClientMessageSchema.parse(chunkMessage(1)),
    ).toEqual(chunkMessage(1));
    expect(
      streamingTranscriptionClientMessageSchema.parse(finishMessage(2)),
    ).toEqual(finishMessage(2));
    expect(
      streamingTranscriptionClientMessageSchema.parse(cancelMessage(2)),
    ).toEqual(cancelMessage(2));
  });

  it('start 只接受受控音频格式，拒绝非法采样率/声道/编码', () => {
    for (const overrides of [
      { sampleRate: 8_000 },
      { sampleRate: 44_100 },
      { channels: 2 },
      { channels: 0 },
      { encoding: 'pcm_f32le' },
      { encoding: 'mp3' },
      { encoding: 'wav' },
    ]) {
      expect(() =>
        streamingTranscriptionClientMessageSchema.parse(
          startMessage(overrides),
        ),
      ).toThrow();
    }
  });

  it('start 拒绝身份、Notebook、Provider、模型路径与 Secret 字段', () => {
    for (const overrides of [
      { actorId: 'student:1' },
      { notebookId: 'notebook:1' },
      { provider: 'sherpa' },
      { modelPath: '/models/zipformer.onnx' },
      { modelAlias: 'transcription' },
      { apiKey: 'sk-secret-123' },
      { token: 'secret-token' },
    ]) {
      expect(() =>
        streamingTranscriptionClientMessageSchema.parse(
          startMessage(overrides),
        ),
      ).toThrow();
    }
  });

  it('start 的 sequence 固定为 0', () => {
    for (const sequence of [1, 2, -1, 0.5]) {
      expect(() =>
        streamingTranscriptionClientMessageSchema.parse(
          startMessage({ sequence }),
        ),
      ).toThrow();
    }
  });

  it('chunk 复用 V04 PCM 上限：接受上限内分片，拒绝空/奇数/超限', () => {
    expect(
      streamingTranscriptionClientMessageSchema.parse(
        chunkMessage(1, { pcmBytes: new Uint8Array(MAX_PCM_CHUNK_BYTES) }),
      ).type,
    ).toBe('chunk');
    expect(() =>
      streamingTranscriptionClientMessageSchema.parse(
        chunkMessage(1, { pcmBytes: new Uint8Array(0) }),
      ),
    ).toThrow();
    expect(() =>
      streamingTranscriptionClientMessageSchema.parse(
        chunkMessage(1, { pcmBytes: new Uint8Array([0x00, 0x00, 0x00]) }),
      ),
    ).toThrow();
    expect(() =>
      streamingTranscriptionClientMessageSchema.parse(
        chunkMessage(1, { pcmBytes: new Uint8Array(MAX_PCM_CHUNK_BYTES + 2) }),
      ),
    ).toThrow();
  });

  it('chunk 不接受 URL、文件路径、Base64 data URL、Prompt 或密钥字段', () => {
    for (const overrides of [
      { url: 'https://example.com/audio.wav' },
      { path: '/tmp/audio.wav' },
      { filePath: '/var/audio.pcm' },
      { base64Url: 'data:audio/wav;base64,AAAA' },
      { dataUrl: 'data:audio/wav;base64,QUFBQQ==' },
      { prompt: '请转写这句课堂音频' },
      { apiKey: 'sk-secret-123' },
      { modelPath: '/models/zipformer.onnx' },
      { provider: 'sherpa' },
    ]) {
      expect(() =>
        streamingTranscriptionClientMessageSchema.parse(
          chunkMessage(1, overrides),
        ),
      ).toThrow();
    }
  });

  it('chunk 拒绝非法格式与非法 operationId/segmentId', () => {
    for (const overrides of [
      { sampleRate: 8_000 },
      { channels: 2 },
      { encoding: 'wav' },
      { operationId: '' },
      { segmentId: '  ' },
      { sequence: -1 },
      { sequence: 0.5 },
    ]) {
      expect(() =>
        streamingTranscriptionClientMessageSchema.parse(
          chunkMessage(1, overrides),
        ),
      ).toThrow();
    }
  });

  it('finish/cancel 拒绝额外字段（包括自由错误消息）', () => {
    for (const message of [
      { ...finishMessage(1), reason: 'done' },
      { ...finishMessage(1), message: 'free text' },
      { ...cancelMessage(1), reason: 'user aborted' },
      { ...cancelMessage(1), detail: '内部细节' },
    ]) {
      expect(() =>
        streamingTranscriptionClientMessageSchema.parse(message),
      ).toThrow();
    }
  });

  it('拒绝未知 protocolVersion、未知 type 与缺失必需字段', () => {
    for (const message of [
      { ...startMessage(), protocolVersion: 'educanvas.turn.v2' },
      { ...chunkMessage(1), protocolVersion: 'educanvas.turn.v2' },
      { ...finishMessage(1), protocolVersion: 'educanvas.turn.v2' },
      { ...cancelMessage(1), protocolVersion: 'educanvas.turn.v2' },
      { ...startMessage(), type: 'hello' },
      { ...finishMessage(1), operationId: undefined },
      { ...cancelMessage(1), segmentId: undefined },
    ]) {
      expect(() =>
        streamingTranscriptionClientMessageSchema.parse(message),
      ).toThrow();
    }
  });
});

describe('server envelope Schema（复用 V04 事件）', () => {
  it('接受 partial/endpoint/final/failed 四类消息', () => {
    expect(
      streamingTranscriptionServerMessageSchema.parse(serverPartial(0)),
    ).toEqual(serverPartial(0));
    expect(
      streamingTranscriptionServerMessageSchema.parse(serverEndpoint(1)),
    ).toEqual(serverEndpoint(1));
    expect(
      streamingTranscriptionServerMessageSchema.parse(serverFinal(2)),
    ).toEqual(serverFinal(2));
    expect(
      streamingTranscriptionServerMessageSchema.parse(serverFailed(3)),
    ).toEqual(serverFailed(3));
  });

  it('server 消息不包含 client 类型，也不新增自由错误 message', () => {
    for (const message of [
      {
        ...base,
        type: 'start',
        sequence: 0,
        sampleRate: 16_000,
        channels: 1,
        encoding: 'pcm_s16le',
      },
      { ...base, type: 'finish', sequence: 1 },
      { ...serverFailed(0), message: 'provider body: retry later' },
      { ...serverFailed(0), detail: '内部堆栈细节' },
      { ...serverPartial(0, 'x'), stack: 'at adapter (line 1)' },
    ]) {
      expect(() =>
        streamingTranscriptionServerMessageSchema.parse(message),
      ).toThrow();
    }
  });

  it('拒绝未知 protocolVersion 与非法失败码', () => {
    expect(() =>
      streamingTranscriptionServerMessageSchema.parse({
        ...serverFinal(0),
        protocolVersion: 'educanvas.turn.v2',
      }),
    ).toThrow();
    expect(() =>
      streamingTranscriptionServerMessageSchema.parse(
        serverFailed(0, 'NOT_A_CODE' as never),
      ),
    ).toThrow();
  });
});

describe('client 消息序列验证器（唯一终态动作纪律）', () => {
  it('接受合法序列：空、仅 start、start→终态动作、start→chunks→终态动作', () => {
    const validSequences: ReadonlyArray<
      readonly StreamingTranscriptionClientMessage[]
    > = [
      [],
      [startMessage()],
      [startMessage(), finishMessage(1)],
      [startMessage(), cancelMessage(1)],
      [startMessage(), chunkMessage(1), chunkMessage(2), finishMessage(3)],
      [startMessage(), chunkMessage(1), chunkMessage(2), cancelMessage(3)],
    ];
    for (const sequence of validSequences) {
      expect(
        validateStreamingTranscriptionClientMessageSequence(sequence),
      ).toBe(true);
    }
  });

  it('拒绝无 start 开头、重复 start、重复 finish/cancel', () => {
    const invalidSequences: ReadonlyArray<
      readonly StreamingTranscriptionClientMessage[]
    > = [
      [chunkMessage(0)],
      [finishMessage(0)],
      [cancelMessage(0)],
      [startMessage(), startMessage()],
      [startMessage(), finishMessage(1), finishMessage(2)],
      [startMessage(), cancelMessage(1), cancelMessage(2)],
    ];
    for (const sequence of invalidSequences) {
      expect(
        validateStreamingTranscriptionClientMessageSequence(sequence),
      ).toBe(false);
    }
  });

  it('拒绝 finish/cancel 后的 chunk 与 finish/cancel 互斥', () => {
    const invalidSequences: ReadonlyArray<
      readonly StreamingTranscriptionClientMessage[]
    > = [
      [startMessage(), finishMessage(1), chunkMessage(2)],
      [startMessage(), cancelMessage(1), chunkMessage(2)],
      [startMessage(), finishMessage(1), cancelMessage(2)],
      [startMessage(), cancelMessage(1), finishMessage(2)],
    ];
    for (const sequence of invalidSequences) {
      expect(
        validateStreamingTranscriptionClientMessageSequence(sequence),
      ).toBe(false);
    }
  });

  it('拒绝乱序、跳号、重复序号与跨 operationId/segmentId 混流', () => {
    const invalidSequences: ReadonlyArray<
      readonly StreamingTranscriptionClientMessage[]
    > = [
      [startMessage(), chunkMessage(2)],
      [startMessage(), chunkMessage(1), chunkMessage(1)],
      [startMessage(), { ...chunkMessage(1), operationId: 'operation:2' }],
      [startMessage(), { ...chunkMessage(1), segmentId: 'segment:2' }],
    ];
    for (const sequence of invalidSequences) {
      expect(
        validateStreamingTranscriptionClientMessageSequence(sequence),
      ).toBe(false);
    }
  });
});

describe('server 消息序列验证器（唯一终态纪律，复用 V04）', () => {
  it('接受 partial→final 与 failed(CANCELLED) 表达 cancel 语义', () => {
    expect(
      validateStreamingTranscriptionServerMessageSequence([
        serverPartial(0),
        serverFinal(1),
      ]),
    ).toBe(true);
    expect(
      validateStreamingTranscriptionServerMessageSequence([
        serverPartial(0),
        serverEndpoint(1),
        serverFinal(2),
      ]),
    ).toBe(true);
    expect(
      validateStreamingTranscriptionServerMessageSequence([
        serverFailed(0, 'CANCELLED'),
      ]),
    ).toBe(true);
  });

  it('拒绝终态后消息与 final/failed 双终态', () => {
    const invalidSequences: ReadonlyArray<
      readonly StreamingTranscriptionServerMessage[]
    > = [
      [serverFinal(0), serverPartial(1)],
      [serverFinal(0), serverFailed(1)],
      [serverFailed(0), serverFinal(1)],
      [serverFailed(0), serverFailed(1)],
    ];
    for (const sequence of invalidSequences) {
      expect(
        validateStreamingTranscriptionServerMessageSequence(sequence),
      ).toBe(false);
    }
  });
});

describe('错误结果不泄漏敏感内容', () => {
  it('chunk 被拒时错误不含 PCM、Prompt、Provider body、stack、路径或密钥', () => {
    const pcmContent = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expectRejectedWithoutLeak(
      chunkMessage(1, {
        pcmBytes: pcmContent,
        url: 'https://example.com/audio.wav',
        prompt: '请转写这句课堂音频',
        apiKey: 'sk-secret-123',
        modelPath: '/models/zipformer.onnx',
        stack: 'at adapter (line 1)',
      }),
      [
        'https://example.com',
        '/models/zipformer.onnx',
        '请转写这句课堂音频',
        'sk-secret-123',
        'at adapter',
        '0xde',
      ],
    );
  });

  it('start 被拒时错误不含身份、Provider、模型路径与密钥', () => {
    expectRejectedWithoutLeak(
      startMessage({
        actorId: 'student:1',
        provider: 'sherpa',
        modelPath: '/models/zipformer.onnx',
        apiKey: 'sk-secret-123',
      }),
      ['student:1', 'sherpa', '/models/zipformer.onnx', 'sk-secret-123'],
    );
  });

  it('超限 PCM 被拒时错误不含分片字节内容', () => {
    expectRejectedWithoutLeak(
      chunkMessage(1, { pcmBytes: new Uint8Array(MAX_PCM_CHUNK_BYTES + 2) }),
      ['32002', '0,0,0,0'],
    );
  });
});

describe('公共入口导出', () => {
  it('envelope schema、类型与验证器可从 agent-core 公共入口导入', async () => {
    const entry = await import('./index');
    expect(entry.streamingTranscriptionClientMessageSchema).toBe(
      streamingTranscriptionClientMessageSchema,
    );
    expect(entry.streamingTranscriptionServerMessageSchema).toBe(
      streamingTranscriptionServerMessageSchema,
    );
    expect(entry.validateStreamingTranscriptionClientMessageSequence).toBe(
      validateStreamingTranscriptionClientMessageSequence,
    );
    expect(entry.validateStreamingTranscriptionServerMessageSequence).toBe(
      validateStreamingTranscriptionServerMessageSequence,
    );
  });
});
