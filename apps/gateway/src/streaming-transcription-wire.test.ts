/**
 * V12 wire 编解码测试：JSON 文本帧 → V07 client 消息。
 * 覆盖 base64 PCM 解码、伪造身份字段拒绝与各类非法帧的稳定 reason。
 */

import { streamingTranscriptionProtocolVersion } from '@educanvas/agent-core';
import { describe, expect, it } from 'vitest';
import { decodeStreamingTranscriptionWireMessage } from './streaming-transcription-wire';

const start = {
  type: 'start',
  protocolVersion: streamingTranscriptionProtocolVersion,
  operationId: 'op:1',
  segmentId: 'seg:1',
  sequence: 0,
  sampleRate: 16_000,
  channels: 1,
  encoding: 'pcm_s16le',
};

function encodePcm(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

describe('decodeStreamingTranscriptionWireMessage', () => {
  it('接受合法 start 消息', () => {
    const result = decodeStreamingTranscriptionWireMessage(
      JSON.stringify(start),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe('start');
      expect(result.message.operationId).toBe('op:1');
    }
  });

  it('把 chunk 的 base64 pcmBytes 解码为 Uint8Array', () => {
    const pcm = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const result = decodeStreamingTranscriptionWireMessage(
      JSON.stringify({
        type: 'chunk',
        protocolVersion: streamingTranscriptionProtocolVersion,
        operationId: 'op:1',
        segmentId: 'seg:1',
        sequence: 1,
        chunkSequence: 0,
        sampleRate: 16_000,
        channels: 1,
        encoding: 'pcm_s16le',
        pcmBytes: encodePcm(pcm),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.message.type === 'chunk') {
      expect(result.message.pcmBytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(result.message.pcmBytes)).toEqual(Array.from(pcm));
    }
  });

  it('拒绝非法 JSON（invalid_json）', () => {
    expect(decodeStreamingTranscriptionWireMessage('{not json')).toEqual({
      ok: false,
      reason: 'invalid_json',
    });
  });

  it('拒绝非对象 JSON（invalid_schema）', () => {
    expect(decodeStreamingTranscriptionWireMessage('"hello"')).toEqual({
      ok: false,
      reason: 'invalid_schema',
    });
    expect(decodeStreamingTranscriptionWireMessage('[1,2]')).toEqual({
      ok: false,
      reason: 'invalid_schema',
    });
  });

  it('拒绝 pcmBytes 非字符串（invalid_pcm_base64）', () => {
    expect(
      decodeStreamingTranscriptionWireMessage(
        JSON.stringify({
          ...start,
          type: 'chunk',
          chunkSequence: 0,
          pcmBytes: 123,
        }),
      ),
    ).toEqual({ ok: false, reason: 'invalid_pcm_base64' });
  });

  it('拒绝 pcmBytes 为空（invalid_pcm_base64）', () => {
    expect(
      decodeStreamingTranscriptionWireMessage(
        JSON.stringify({
          ...start,
          type: 'chunk',
          chunkSequence: 0,
          pcmBytes: '',
        }),
      ),
    ).toEqual({ ok: false, reason: 'invalid_pcm_base64' });
  });

  it('拒绝 pcmBytes 含 base64 非法字符（invalid_pcm_base64）', () => {
    expect(
      decodeStreamingTranscriptionWireMessage(
        JSON.stringify({
          ...start,
          type: 'chunk',
          chunkSequence: 0,
          pcmBytes: 'not%base64!!',
        }),
      ),
    ).toEqual({ ok: false, reason: 'invalid_pcm_base64' });
  });

  it('拒绝 pcmBytes padding 非法（invalid_pcm_base64）', () => {
    // 'AA' 长度 2 不是 4 的倍数（合法 base64 长度必须是 4 的倍数）。
    expect(
      decodeStreamingTranscriptionWireMessage(
        JSON.stringify({
          ...start,
          type: 'chunk',
          chunkSequence: 0,
          pcmBytes: 'AA',
        }),
      ),
    ).toEqual({ ok: false, reason: 'invalid_pcm_base64' });
  });

  it('拒绝解码后字节为奇数长度（invalid_schema）', () => {
    const odd = new Uint8Array([0x00, 0x01, 0x02]);
    expect(
      decodeStreamingTranscriptionWireMessage(
        JSON.stringify({
          ...start,
          type: 'chunk',
          chunkSequence: 0,
          pcmBytes: encodePcm(odd),
        }),
      ),
    ).toEqual({ ok: false, reason: 'invalid_schema' });
  });

  it('拒绝超过单分片字节上限（invalid_schema）', () => {
    const tooLarge = new Uint8Array(32_002);
    expect(
      decodeStreamingTranscriptionWireMessage(
        JSON.stringify({
          ...start,
          type: 'chunk',
          chunkSequence: 0,
          pcmBytes: encodePcm(tooLarge),
        }),
      ),
    ).toEqual({ ok: false, reason: 'invalid_schema' });
  });

  it('拒绝客户端伪造身份字段（strict schema，invalid_schema）', () => {
    const forged = { ...start, userId: 'user:attacker', role: 'owner' };
    expect(
      decodeStreamingTranscriptionWireMessage(JSON.stringify(forged)),
    ).toEqual({ ok: false, reason: 'invalid_schema' });
  });

  it('拒绝 chunk 伪造 notebookId（invalid_schema）', () => {
    expect(
      decodeStreamingTranscriptionWireMessage(
        JSON.stringify({
          ...start,
          type: 'chunk',
          chunkSequence: 0,
          pcmBytes: encodePcm(new Uint8Array([0, 0])),
          notebookId: 'notebook:other',
        }),
      ),
    ).toEqual({ ok: false, reason: 'invalid_schema' });
  });

  it('拒绝 finish/cancel 之外的未知消息类型（invalid_schema）', () => {
    expect(
      decodeStreamingTranscriptionWireMessage(
        JSON.stringify({ ...start, type: 'explode' }),
      ),
    ).toEqual({ ok: false, reason: 'invalid_schema' });
  });
});
