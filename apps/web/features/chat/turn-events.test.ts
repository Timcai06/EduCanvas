import { describe, expect, it, vi } from 'vitest';
import {
  consumeTeachingTurnResponse,
  parseTeachingTurnEvent,
  TurnStreamProtocolError,
} from './turn-events';

function responseFromChunks(chunks: readonly string[]): {
  response: Response;
  stream: ReadableStream<Uint8Array>;
} {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return {
    stream,
    response: new Response(stream, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }),
  };
}

describe('teaching turn SSE protocol', () => {
  it('parses split CRLF frames and only emits provider-neutral events', async () => {
    const accepted = JSON.stringify({
      type: 'turn.accepted',
      schemaVersion: '1',
      turnId: 'turn-1',
      studentMessageId: 'student-1',
      assistantMessageId: 'assistant-1',
      replayed: false,
    });
    const tool = JSON.stringify({
      type: 'tool.started',
      schemaVersion: '1',
      turnId: 'turn-1',
      toolCallId: 'tool-1',
      label: '查找本课资料',
    });
    const delta = JSON.stringify({
      type: 'message.delta',
      schemaVersion: '1',
      turnId: 'turn-1',
      messageId: 'assistant-1',
      delta: '先观察耳朵。',
    });
    const completed = JSON.stringify({
      type: 'turn.completed',
      schemaVersion: '1',
      turnId: 'turn-1',
      messageId: 'assistant-1',
    });
    const payload =
      `: heartbeat\r\nevent: turn.accepted\r\ndata: ${accepted}\r\n\r\n` +
      `event: tool.started\r\ndata: ${tool}\r\n\r\n` +
      `event: message.delta\r\ndata: ${delta}\r\n\r\n` +
      `event: turn.completed\r\ndata: ${completed}\r\n\r\n`;
    const chunks = [
      payload.slice(0, 31),
      payload.slice(31, 97),
      payload.slice(97),
    ];
    const { response, stream } = responseFromChunks(chunks);
    const onEvent = vi.fn();

    await consumeTeachingTurnResponse(response, onEvent);

    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual([
      'turn.accepted',
      'tool.started',
      'message.delta',
      'turn.completed',
    ]);
    expect(onEvent.mock.calls[2]?.[0]).toMatchObject({
      delta: '先观察耳朵。',
      messageId: 'assistant-1',
    });
    expect(stream.locked).toBe(false);
  });

  it('ignores unknown additive events', () => {
    expect(
      parseTeachingTurnEvent(
        'citation.added',
        JSON.stringify({ type: 'citation.added', schemaVersion: '1' }),
      ),
    ).toBeNull();
  });

  it('严格解析服务端验证过的引用事件', () => {
    expect(
      parseTeachingTurnEvent(
        'message.citation',
        JSON.stringify({
          type: 'message.citation',
          schemaVersion: '1',
          turnId: 'turn-1',
          messageId: 'assistant-1',
          citationId: 'citation-1',
          marker: 3,
          sourceId: 'source-1',
          documentId: 'document-1',
          chunkId: 'chunk-1',
          label: '课程讲义 · 第3页',
          pageStart: 3,
          pageEnd: 3,
        }),
      ),
    ).toMatchObject({
      type: 'message.citation',
      citationId: 'citation-1',
      marker: 3,
      pageStart: 3,
    });
  });

  it('解析通用网页引用并拒绝不安全的原文定位', () => {
    const payload = {
      type: 'message.citation',
      schemaVersion: '1',
      turnId: 'turn-1',
      messageId: 'assistant-1',
      citationId: 'citation-web-1',
      marker: 2,
      kind: 'web',
      assetId: 'asset-1',
      assetVersionId: 'version-1',
      label: '原始研究网页',
      url: 'https://example.com/research',
      pageStart: null,
      pageEnd: null,
    };
    expect(
      parseTeachingTurnEvent('message.citation', JSON.stringify(payload)),
    ).toMatchObject({
      kind: 'web',
      marker: 2,
      assetId: 'asset-1',
      url: 'https://example.com/research',
    });
    expect(() =>
      parseTeachingTurnEvent(
        'message.citation',
        JSON.stringify({ ...payload, url: 'javascript:alert(1)' }),
      ),
    ).toThrow(TurnStreamProtocolError);
  });

  it.each([0, 100, 1.5])('拒绝非法引用标记 %s', (marker) => {
    expect(() =>
      parseTeachingTurnEvent(
        'message.citation',
        JSON.stringify({
          type: 'message.citation',
          schemaVersion: '1',
          turnId: 'turn-1',
          messageId: 'assistant-1',
          citationId: 'citation-1',
          marker,
          sourceId: 'source-1',
          documentId: 'document-1',
          chunkId: 'chunk-1',
          label: '课程讲义',
          pageStart: null,
          pageEnd: null,
        }),
      ),
    ).toThrow(TurnStreamProtocolError);
  });

  it.each([
    [
      'payload type mismatch',
      'message.delta',
      {
        type: 'turn.completed',
        schemaVersion: '1',
        turnId: 'turn-1',
        messageId: 'assistant-1',
        delta: 'x',
      },
    ],
    [
      'empty delta',
      'message.delta',
      {
        type: 'message.delta',
        schemaVersion: '1',
        turnId: 'turn-1',
        messageId: 'assistant-1',
        delta: '',
      },
    ],
    [
      'unsupported version',
      'turn.completed',
      {
        type: 'turn.completed',
        schemaVersion: '2',
        turnId: 'turn-1',
        messageId: 'assistant-1',
      },
    ],
  ])('rejects %s', (_label, eventName, data) => {
    expect(() =>
      parseTeachingTurnEvent(eventName, JSON.stringify(data)),
    ).toThrow(TurnStreamProtocolError);
  });

  it('解析全部 artifact 生命周期事件并拒绝畸形字段', () => {
    const base = { schemaVersion: '1', turnId: 'turn-1' };
    expect(
      parseTeachingTurnEvent(
        'artifact.proposed',
        JSON.stringify({
          ...base,
          type: 'artifact.proposed',
          artifactId: 'artifact-1',
          kind: 'mind_map',
          trustTier: 'tier1',
          title: '思维导图',
        }),
      ),
    ).toMatchObject({ type: 'artifact.proposed', kind: 'mind_map' });

    expect(
      parseTeachingTurnEvent(
        'artifact.version_added',
        JSON.stringify({
          ...base,
          type: 'artifact.version_added',
          artifactId: 'artifact-1',
          version: 3,
        }),
      ),
    ).toMatchObject({ version: 3 });

    expect(
      parseTeachingTurnEvent(
        'artifact.generation_progress',
        JSON.stringify({
          ...base,
          type: 'artifact.generation_progress',
          artifactId: 'artifact-1',
          jobId: 'job-1',
          progress: 55,
        }),
      ),
    ).toMatchObject({ progress: 55 });

    expect(
      parseTeachingTurnEvent(
        'artifact.failed',
        JSON.stringify({
          ...base,
          type: 'artifact.failed',
          artifactId: 'artifact-1',
          code: 'provider_timeout',
        }),
      ),
    ).toMatchObject({ code: 'provider_timeout' });

    for (const bad of [
      {
        type: 'artifact.proposed',
        artifactId: 'a',
        kind: 'Bad-Kind',
        trustTier: 'tier1',
        title: 't',
      },
      {
        type: 'artifact.proposed',
        artifactId: 'a',
        kind: 'mind_map',
        trustTier: 'tier3',
        title: 't',
      },
      { type: 'artifact.version_added', artifactId: 'a', version: 0 },
      {
        type: 'artifact.generation_progress',
        artifactId: 'a',
        jobId: 'j',
        progress: 101,
      },
      { type: 'artifact.failed', artifactId: 'a' },
    ]) {
      expect(() =>
        parseTeachingTurnEvent(bad.type, JSON.stringify({ ...base, ...bad })),
      ).toThrow(TurnStreamProtocolError);
    }
  });

  it('bounds a frame without a delimiter and releases the reader', async () => {
    const { response, stream } = responseFromChunks(['x'.repeat(131_073)]);

    await expect(
      consumeTeachingTurnResponse(response, () => undefined),
    ).rejects.toThrow('buffer is too large');
    expect(stream.locked).toBe(false);
  });
});
