import { describe, expect, it } from 'vitest';
import type {
  AudioTranscriptionModelGateway,
  AudioTranscriptionRequest,
  AudioTranscriptionResult,
} from './model-gateway';
import {
  MAX_PCM_CHUNK_BYTES,
  MAX_STREAMING_TRANSCRIPTION_TEXT_LENGTH,
  StreamingTranscriptionStateError,
  isStreamingTranscriptionTerminalEvent,
  streamingTranscriptionEventSchema,
  streamingTranscriptionFailureCodes,
  streamingTranscriptionPcmChunkSchema,
  streamingTranscriptionProtocolVersion,
  validateStreamingTranscriptionEventSequence,
  type StreamingTranscriptionEvent,
  type StreamingTranscriptionPcmChunk,
} from './streaming-transcription-contracts';

const chunk = (
  overrides: Partial<StreamingTranscriptionPcmChunk> = {},
): StreamingTranscriptionPcmChunk => ({
  operationId: 'operation:1',
  segmentId: 'segment:1',
  sequence: 0,
  sampleRate: 16_000,
  channels: 1,
  encoding: 'pcm_s16le',
  pcmBytes: new Uint8Array([0x00, 0x00]),
  ...overrides,
});

const eventBase = {
  protocolVersion: streamingTranscriptionProtocolVersion,
  operationId: 'operation:1',
  segmentId: 'segment:1',
} as const;

const event = <T extends StreamingTranscriptionEvent>(value: T): T => value;
const partial = (sequence: number, text = '你好') =>
  event({ ...eventBase, type: 'partial', sequence, text });
const endpoint = (sequence: number) =>
  event({ ...eventBase, type: 'endpoint', sequence });
const finalEvent = (sequence: number, text = '你好世界') =>
  event({ ...eventBase, type: 'final', sequence, text });
const failed = (sequence: number, failureCode: string = 'MODEL_FAILED') =>
  event({
    ...eventBase,
    type: 'failed',
    sequence,
    failureCode,
  } as StreamingTranscriptionEvent);

describe('PCM 分片契约', () => {
  it('接受合法 16 kHz 单声道 PCM s16le 分片', () => {
    const value = chunk({ pcmBytes: new Uint8Array([0x00, 0x00, 0x00, 0x00]) });
    expect(streamingTranscriptionPcmChunkSchema.parse(value)).toEqual(value);
    expect(
      streamingTranscriptionPcmChunkSchema.parse(
        chunk({ pcmBytes: new Uint8Array(MAX_PCM_CHUNK_BYTES) }),
      ).pcmBytes.length,
    ).toBe(MAX_PCM_CHUNK_BYTES);
  });

  it('拒绝非 16 kHz 采样率', () => {
    for (const sampleRate of [8_000, 44_100, 22_050]) {
      expect(() =>
        streamingTranscriptionPcmChunkSchema.parse(
          chunk({ sampleRate } as never),
        ),
      ).toThrow();
    }
  });

  it('拒绝非单声道', () => {
    for (const channels of [2, 0]) {
      expect(() =>
        streamingTranscriptionPcmChunkSchema.parse(
          chunk({ channels } as never),
        ),
      ).toThrow();
    }
  });

  it('拒绝非 PCM s16le 编码', () => {
    for (const encoding of ['pcm_f32le', 'pcm_s16be', 'wav', 'mp3']) {
      expect(() =>
        streamingTranscriptionPcmChunkSchema.parse(
          chunk({ encoding } as never),
        ),
      ).toThrow();
    }
  });

  it('拒绝空字节、奇数字节与超限字节', () => {
    expect(() =>
      streamingTranscriptionPcmChunkSchema.parse(
        chunk({ pcmBytes: new Uint8Array(0) }),
      ),
    ).toThrow();
    expect(() =>
      streamingTranscriptionPcmChunkSchema.parse(
        chunk({ pcmBytes: new Uint8Array([0x00, 0x00, 0x00]) }),
      ),
    ).toThrow();
    expect(() =>
      streamingTranscriptionPcmChunkSchema.parse(
        chunk({ pcmBytes: new Uint8Array(MAX_PCM_CHUNK_BYTES + 2) }),
      ),
    ).toThrow();
  });

  it('拒绝负数、小数与非安全整数 sequence', () => {
    expect(() =>
      streamingTranscriptionPcmChunkSchema.parse(chunk({ sequence: -1 })),
    ).toThrow();
    expect(() =>
      streamingTranscriptionPcmChunkSchema.parse(chunk({ sequence: 0.5 })),
    ).toThrow();
    expect(() =>
      streamingTranscriptionPcmChunkSchema.parse(chunk({ sequence: 2 ** 53 })),
    ).toThrow();
    expect(
      streamingTranscriptionPcmChunkSchema.parse(
        chunk({ sequence: Number.MAX_SAFE_INTEGER }),
      ).sequence,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('拒绝空或非法的 operationId/segmentId', () => {
    for (const key of ['operationId', 'segmentId']) {
      expect(() =>
        streamingTranscriptionPcmChunkSchema.parse(chunk({ [key]: '' })),
      ).toThrow();
      expect(() =>
        streamingTranscriptionPcmChunkSchema.parse(chunk({ [key]: '  ' })),
      ).toThrow();
      expect(() =>
        streamingTranscriptionPcmChunkSchema.parse(
          chunk({ [key]: 'x'.repeat(257) }),
        ),
      ).toThrow();
    }
  });

  it('拒绝音频路径、Base64 URL、模型路径、Provider 类型与身份字段', () => {
    expect(() =>
      streamingTranscriptionPcmChunkSchema.parse(
        chunk({ path: '/tmp/audio.wav' } as never),
      ),
    ).toThrow();
    expect(() =>
      streamingTranscriptionPcmChunkSchema.parse(
        chunk({ base64Url: 'data:audio/wav;base64,AAAA' } as never),
      ),
    ).toThrow();
    expect(() =>
      streamingTranscriptionPcmChunkSchema.parse(
        chunk({ modelPath: '/models/zipformer.onnx' } as never),
      ),
    ).toThrow();
    expect(() =>
      streamingTranscriptionPcmChunkSchema.parse(
        chunk({ provider: 'sherpa' } as never),
      ),
    ).toThrow();
    expect(() =>
      streamingTranscriptionPcmChunkSchema.parse(
        chunk({ actorId: 'student:1' } as never),
      ),
    ).toThrow();
  });
});

describe('流式转录事件 Schema', () => {
  it('接受 partial/final/endpoint/failed 合法事件', () => {
    expect(streamingTranscriptionEventSchema.parse(partial(0))).toEqual(
      partial(0),
    );
    expect(streamingTranscriptionEventSchema.parse(endpoint(1))).toEqual(
      endpoint(1),
    );
    expect(streamingTranscriptionEventSchema.parse(finalEvent(2))).toEqual(
      finalEvent(2),
    );
    expect(streamingTranscriptionEventSchema.parse(failed(3))).toEqual(
      failed(3),
    );
  });

  it('拒绝未知 protocolVersion', () => {
    expect(() =>
      streamingTranscriptionEventSchema.parse({
        ...eventBase,
        protocolVersion: 'educanvas.turn.v2',
        type: 'final',
        sequence: 0,
        text: 'x',
      } as never),
    ).toThrow();
  });

  it('拒绝空白文本与超限文本', () => {
    expect(() =>
      streamingTranscriptionEventSchema.parse(partial(0, '')),
    ).toThrow();
    expect(() =>
      streamingTranscriptionEventSchema.parse(partial(0, ' \n\t')),
    ).toThrow();
    expect(() =>
      streamingTranscriptionEventSchema.parse(
        partial(0, 'x'.repeat(MAX_STREAMING_TRANSCRIPTION_TEXT_LENGTH + 1)),
      ),
    ).toThrow();
    const parsed = streamingTranscriptionEventSchema.parse(
      finalEvent(1, 'x'.repeat(MAX_STREAMING_TRANSCRIPTION_TEXT_LENGTH)),
    );
    if (parsed.type !== 'final') {
      throw new Error('期望 final 事件');
    }
    expect(parsed.text.length).toBe(MAX_STREAMING_TRANSCRIPTION_TEXT_LENGTH);
  });

  it('failed 事件拒绝 stack、原始错误对象与额外字段', () => {
    expect(() =>
      streamingTranscriptionEventSchema.parse({
        ...failed(0, 'MODEL_FAILED'),
        stack: 'at adapter (line 1)',
      } as never),
    ).toThrow();
    expect(() =>
      streamingTranscriptionEventSchema.parse({
        ...failed(0, 'MODEL_FAILED'),
        error: { message: 'provider body', raw: '...' },
      } as never),
    ).toThrow();
    expect(() =>
      streamingTranscriptionEventSchema.parse({
        ...failed(0, 'MODEL_FAILED'),
        detail: '内部细节',
      } as never),
    ).toThrow();
    expect(() =>
      streamingTranscriptionEventSchema.parse(failed(0, 'NOT_A_CODE' as never)),
    ).toThrow();
    expect(() =>
      streamingTranscriptionEventSchema.parse({
        ...eventBase,
        type: 'failed',
        sequence: 0,
      } as never),
    ).toThrow();
  });

  it('partial/final/failed 不携带 PCM、Secret 或 Prompt 字段', () => {
    for (const type of ['partial', 'final', 'failed']) {
      expect(() =>
        streamingTranscriptionEventSchema.parse({
          ...eventBase,
          type,
          sequence: 0,
          text: 'x',
          failureCode: 'MODEL_FAILED',
          pcmBytes: new Uint8Array([0x00]),
          prompt: '请转写',
          apiKey: 'secret',
        } as never),
      ).toThrow();
    }
  });

  it('暴露稳定失败码清单', () => {
    expect(streamingTranscriptionFailureCodes).toEqual([
      'INVALID_PCM_CHUNK',
      'INPUT_AFTER_FINISH',
      'INPUT_AFTER_ENDPOINT',
      'INPUT_AFTER_TERMINAL',
      'MODEL_FAILED',
      'CANCELLED',
      'UNKNOWN',
    ]);
  });
});

describe('跨消息序列验证器（唯一终态纪律）', () => {
  it('空序列合法', () => {
    expect(validateStreamingTranscriptionEventSequence([])).toBe(true);
  });

  it('接受 partial → final 与 partial → endpoint → final', () => {
    expect(
      validateStreamingTranscriptionEventSequence([partial(0), finalEvent(1)]),
    ).toBe(true);
    expect(
      validateStreamingTranscriptionEventSequence([
        partial(0),
        endpoint(1),
        finalEvent(2),
      ]),
    ).toBe(true);
    expect(validateStreamingTranscriptionEventSequence([failed(0)])).toBe(true);
  });

  it('拒绝终态后继续发送事件', () => {
    expect(
      validateStreamingTranscriptionEventSequence([
        partial(0),
        finalEvent(1),
        partial(2),
      ]),
    ).toBe(false);
    expect(
      validateStreamingTranscriptionEventSequence([failed(0), failed(1)]),
    ).toBe(false);
    expect(
      validateStreamingTranscriptionEventSequence([
        finalEvent(0),
        finalEvent(1),
      ]),
    ).toBe(false);
  });

  it('拒绝 endpoint 后 partial 与重复 endpoint', () => {
    expect(
      validateStreamingTranscriptionEventSequence([
        partial(0),
        endpoint(1),
        partial(2),
      ]),
    ).toBe(false);
    expect(
      validateStreamingTranscriptionEventSequence([endpoint(0), endpoint(1)]),
    ).toBe(false);
    expect(
      validateStreamingTranscriptionEventSequence([
        partial(0),
        endpoint(1),
        endpoint(2),
      ]),
    ).toBe(false);
  });

  it('拒绝重复、跳号或负数 sequence', () => {
    expect(
      validateStreamingTranscriptionEventSequence([partial(0), partial(0)]),
    ).toBe(false);
    expect(
      validateStreamingTranscriptionEventSequence([partial(0), partial(2)]),
    ).toBe(false);
    expect(
      validateStreamingTranscriptionEventSequence([
        { ...partial(1) } as StreamingTranscriptionEvent,
      ]),
    ).toBe(false);
  });

  it('拒绝跨 operationId 或跨 segmentId 混流', () => {
    expect(
      validateStreamingTranscriptionEventSequence([
        partial(0),
        {
          ...partial(1),
          operationId: 'operation:2',
        },
      ]),
    ).toBe(false);
    expect(
      validateStreamingTranscriptionEventSequence([
        partial(0),
        { ...partial(1), segmentId: 'segment:2' },
      ]),
    ).toBe(false);
  });

  it('cancel 以 failed + CANCELLED 表达且保持唯一终态', () => {
    expect(
      validateStreamingTranscriptionEventSequence([
        partial(0),
        failed(1, 'CANCELLED'),
      ]),
    ).toBe(true);
    expect(
      validateStreamingTranscriptionEventSequence([
        failed(0, 'CANCELLED'),
        partial(1),
      ]),
    ).toBe(false);
    expect(isStreamingTranscriptionTerminalEvent(failed(0, 'CANCELLED'))).toBe(
      true,
    );
    expect(isStreamingTranscriptionTerminalEvent(partial(0))).toBe(false);
    expect(isStreamingTranscriptionTerminalEvent(endpoint(0))).toBe(false);
  });
});

describe('稳定错误与一次性 Port 兼容性', () => {
  it('StreamingTranscriptionStateError 只暴露稳定失败码', () => {
    const error = new StreamingTranscriptionStateError('INPUT_AFTER_TERMINAL');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('StreamingTranscriptionStateError');
    expect(error.code).toBe('INPUT_AFTER_TERMINAL');
    expect(error.message).toBe('INPUT_AFTER_TERMINAL');
    expect(JSON.stringify(error)).not.toContain('stack');
  });

  it('现有 AudioTranscriptionModelGateway 保持兼容', async () => {
    const oneShotGateway: AudioTranscriptionModelGateway = {
      async transcribeAudio(
        request: AudioTranscriptionRequest,
      ): Promise<AudioTranscriptionResult> {
        expect(request.modelAlias).toBe('transcription');
        expect(request.audioBytes).toBeInstanceOf(Uint8Array);
        return {
          text: '一次性转录仍可用',
          language: null,
          durationSeconds: null,
          metadata: {
            providerResponseId: 'response-once-1',
            provider: 'fixture-provider',
            taskAlias: request.taskAlias,
            modelAlias: request.modelAlias,
            resolvedModelId: 'fixture/model-v1',
            modelRevision: null,
            systemFingerprint: null,
            finishReason: 'stop',
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              cacheHitTokens: 0,
              reasoningTokens: 0,
            },
            latencyMs: 1,
            traceId: request.traceId,
          },
        };
      },
    };

    const result = await oneShotGateway.transcribeAudio({
      taskAlias: 'audio.transcribe',
      modelAlias: 'transcription',
      audioBytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
      mimeType: 'audio/wav',
      promptVersion: 'transcription-v1',
      traceId: 'trace-once-1',
      operationId: 'operation:once:1',
    });
    expect(result.text).toBe('一次性转录仍可用');
  });
});
