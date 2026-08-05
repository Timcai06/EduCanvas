import { describe, expect, it } from 'vitest';
import {
  StreamingTranscriptionStateError,
  validateStreamingTranscriptionEventSequence,
  type StreamingTranscriptionEvent,
  type StreamingTranscriptionPcmChunk,
} from './streaming-transcription-contracts';
import type {
  StreamingTranscriptionGateway,
  StreamingTranscriptionRequest,
  StreamingTranscriptionSession,
} from './streaming-transcription-port';

const chunk = (sequence: number): StreamingTranscriptionPcmChunk => ({
  operationId: 'operation:1',
  segmentId: 'segment:1',
  sequence,
  sampleRate: 16_000,
  channels: 1,
  encoding: 'pcm_s16le',
  pcmBytes: new Uint8Array([0x00, 0x00]),
});

/**
 * 最小会话实现：只用于证明 Port 形状可被供应商无关的外部实现满足。
 * 它按"每次 pushChunk 产出一个 partial、finish 产出 final、cancel 产出
 * failed(CANCELLED)"推进，不含真实分片累积或端点判定（那是 V08 的职责）。
 */
function createFakeSession(): StreamingTranscriptionSession {
  const queue: StreamingTranscriptionEvent[] = [];
  let terminalSeen = false;
  let endpointSeen = false;
  let inputFinished = false;
  let sequence = 0;
  let notify: (() => void) | undefined;

  const waitForEvent = async (): Promise<void> => {
    while (queue.length === 0 && !terminalSeen) {
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
      notify = undefined;
    }
  };

  return {
    events:
      (async function* events(): AsyncIterable<StreamingTranscriptionEvent> {
        for (;;) {
          if (queue.length > 0) {
            yield queue.shift() as StreamingTranscriptionEvent;
          } else if (terminalSeen) {
            return;
          } else {
            await waitForEvent();
          }
        }
      })(),
    pushChunk(input) {
      if (terminalSeen) {
        throw new StreamingTranscriptionStateError('INPUT_AFTER_TERMINAL');
      }
      if (inputFinished) {
        throw new StreamingTranscriptionStateError('INPUT_AFTER_FINISH');
      }
      if (endpointSeen) {
        throw new StreamingTranscriptionStateError('INPUT_AFTER_ENDPOINT');
      }
      queue.push({
        protocolVersion: 'educanvas.streaming-transcription.v1',
        operationId: input.operationId,
        segmentId: input.segmentId,
        type: 'partial',
        sequence,
        text: `假设-${input.sequence}`,
      });
      sequence += 1;
      notify?.();
    },
    finish() {
      if (terminalSeen || endpointSeen) return;
      inputFinished = true;
      queue.push({
        protocolVersion: 'educanvas.streaming-transcription.v1',
        operationId: 'operation:1',
        segmentId: 'segment:1',
        type: 'final',
        sequence,
        text: '最终文本',
      });
      terminalSeen = true;
      notify?.();
    },
    cancel() {
      if (terminalSeen) return;
      queue.push({
        protocolVersion: 'educanvas.streaming-transcription.v1',
        operationId: 'operation:1',
        segmentId: 'segment:1',
        type: 'failed',
        sequence,
        failureCode: 'CANCELLED',
      });
      terminalSeen = true;
      notify?.();
    },
  };
}

const collect = async (
  session: StreamingTranscriptionSession,
): Promise<StreamingTranscriptionEvent[]> => {
  const events: StreamingTranscriptionEvent[] = [];
  for await (const item of session.events) events.push(item);
  return events;
};

describe('StreamingTranscriptionGateway Port', () => {
  it('beginStreaming 返回会话句柄，事件流保持唯一终态纪律', async () => {
    const gateway: StreamingTranscriptionGateway = {
      beginStreaming(request: StreamingTranscriptionRequest) {
        expect(request.operationId).toBe('operation:1');
        expect(request.segmentId).toBe('segment:1');
        return createFakeSession();
      },
    };

    const session = gateway.beginStreaming({
      operationId: 'operation:1',
      segmentId: 'segment:1',
      traceId: 'trace:1',
    });
    session.pushChunk(chunk(0));
    session.pushChunk(chunk(1));
    session.finish();

    const events = await collect(session);
    expect(events.map((item) => item.type)).toEqual([
      'partial',
      'partial',
      'final',
    ]);
    expect(validateStreamingTranscriptionEventSequence(events)).toBe(true);
  });

  it('cancel 以 failed + CANCELLED 收尾并保持唯一终态', async () => {
    const gateway: StreamingTranscriptionGateway = {
      beginStreaming() {
        return createFakeSession();
      },
    };
    const session = gateway.beginStreaming({
      operationId: 'operation:1',
      segmentId: 'segment:1',
      traceId: 'trace:1',
    });
    session.pushChunk(chunk(0));
    session.cancel();

    const events = await collect(session);
    expect(events.map((item) => item.type)).toEqual(['partial', 'failed']);
    expect(validateStreamingTranscriptionEventSequence(events)).toBe(true);
    expect(events[1]?.type).toBe('failed');
  });

  it('终态后 pushChunk 抛稳定 StreamingTranscriptionStateError', async () => {
    const session = createFakeSession();
    session.pushChunk(chunk(0));
    session.finish();
    await collect(session);

    expect(() => session.pushChunk(chunk(1))).toThrow(
      StreamingTranscriptionStateError,
    );
    expect(() => session.pushChunk(chunk(1))).toThrow(/INPUT_AFTER_TERMINAL/);
  });

  it('finish 后等待终稿阶段有独立稳定错误码', () => {
    const error = new StreamingTranscriptionStateError('INPUT_AFTER_FINISH');
    expect(error.code).toBe('INPUT_AFTER_FINISH');
    expect(error.message).toBe('INPUT_AFTER_FINISH');
  });

  it('Public Port 类型不依赖 sherpa/onnx/HTTP/WebSocket/数据库/SDK 形状', async () => {
    // 编译期保证：本文件只 import 领域契约与 Port 类型，未引用任何
    // Provider SDK 或传输层类型；运行时依赖边界由 dependency-boundary
    // 测试覆盖（agent-core 仅依赖 zod）。
    const gateway: StreamingTranscriptionGateway = {
      beginStreaming() {
        return createFakeSession();
      },
    };
    const session = gateway.beginStreaming({
      operationId: 'operation:1',
      segmentId: 'segment:1',
      traceId: 'trace:1',
      signal: { aborted: false } as StreamingTranscriptionRequest['signal'],
    });
    expect(session).toBeDefined();
    expect(typeof session.pushChunk).toBe('function');
    expect(typeof session.finish).toBe('function');
    expect(typeof session.cancel).toBe('function');
  });
});
