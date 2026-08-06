/**
 * V12 wire 编解码 — WebSocket 文本帧 ↔ V07 client 消息的转换边界。
 *
 * ## 职责
 *
 * - 把传输层收到的 JSON 文本帧解析为对象，并做两层校验：
 *   1. chunk 的 `pcmBytes` 是 wire 上的 base64 字符串（JSON 无法直接携带
 *      二进制），必须先严格 base64 解码为 `Uint8Array`；
 *   2. 解码后的对象再走 V07 `streamingTranscriptionClientMessageSchema`
 *      （`.strict()` 拒绝额外键，因此客户端伪造 userId/role/notebookId
 *      等身份字段会在本层被拒，绝不进入通道）。
 * - 本模块是传输层的一部分：不持有会话状态，不做跨消息校验（那是 V07
 *   验证器 + 通道的职责），也不产生任何日志。
 *
 * ## 安全面
 *
 * - base64 只接受严格字母表与合法 padding（`/^[A-Za-z0-9+/]*={0,2}$/` 且
 *   长度是 4 的倍数），拒绝把宽容解码当作"合法输入"的通道；
 * - 解码后的字节上限由 V04 schema 的 `MAX_PCM_CHUNK_BYTES` 兜底（本模块
 *   不复制该上限，校验委托给 schema）；
 * - 失败只返回稳定 reason，不携带原始帧内容、PCM 或自由错误消息。
 */

import {
  streamingTranscriptionClientMessageSchema,
  type StreamingTranscriptionClientMessage,
} from '@educanvas/agent-core';

/** 严格 base64（RFC 4648，允许可选 padding）；宽容解码是注入通道，明确拒绝。 */
const STRICT_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type StreamingTranscriptionWireDecodeReason =
  'invalid_json' | 'invalid_pcm_base64' | 'invalid_schema';

export type StreamingTranscriptionWireDecodeResult =
  | {
      readonly ok: true;
      readonly message: StreamingTranscriptionClientMessage;
    }
  | {
      readonly ok: false;
      readonly reason: StreamingTranscriptionWireDecodeReason;
    };

/**
 * 解码单个 wire 帧。任何失败都返回稳定 reason，不抛异常：
 * 调用方（transport）据此发送 `INVALID_REQUEST` 传输错误帧并关闭连接。
 */
export function decodeStreamingTranscriptionWireMessage(
  raw: string,
): StreamingTranscriptionWireDecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid_schema' };
  }
  const record = parsed as Record<string, unknown>;
  if ('pcmBytes' in record) {
    const encoded = record.pcmBytes;
    if (
      typeof encoded !== 'string' ||
      encoded.length === 0 ||
      encoded.length % 4 !== 0 ||
      !STRICT_BASE64_PATTERN.test(encoded)
    ) {
      return { ok: false, reason: 'invalid_pcm_base64' };
    }
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length === 0) return { ok: false, reason: 'invalid_pcm_base64' };
    // Buffer 是 Uint8Array 子类：交给 V07 schema 时保持同一字节视图。
    record.pcmBytes = new Uint8Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
  }
  const result = streamingTranscriptionClientMessageSchema.safeParse(record);
  if (!result.success) return { ok: false, reason: 'invalid_schema' };
  return { ok: true, message: result.data };
}
