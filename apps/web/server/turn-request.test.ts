import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  TurnRequestValidationError,
  parseTeachingTurnRequest,
} from './turn-request';

const request = (body: BodyInit | null, contentType = 'application/json') =>
  new Request('https://learn.example/api/v1/learn/turn', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });

describe('teaching turn request boundary', () => {
  it('只接受 clientMessageId 与 text', async () => {
    await expect(
      parseTeachingTurnRequest(
        request(JSON.stringify({ clientMessageId: 'msg-1', text: '  为什么？ ' })),
      ),
    ).resolves.toEqual({ clientMessageId: 'msg-1', text: '  为什么？ ' });

    await expect(
      parseTeachingTurnRequest(
        request(
          JSON.stringify({
            clientMessageId: 'msg-1',
            text: '为什么？',
            sessionId: 'forged',
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('拒绝错误类型、畸形 JSON、空消息和非法幂等键', async () => {
    const cases = [
      request('{}', 'text/plain'),
      request('{'),
      request(JSON.stringify({ clientMessageId: 'msg-1', text: '   ' })),
      request(JSON.stringify({ clientMessageId: '../bad', text: 'x' })),
    ];
    for (const candidate of cases) {
      await expect(parseTeachingTurnRequest(candidate)).rejects.toBeInstanceOf(
        TurnRequestValidationError,
      );
    }
  });

  it('在 JSON 解析前拒绝超过 16KiB 的正文', async () => {
    await expect(
      parseTeachingTurnRequest(request('x'.repeat(16_385))),
    ).rejects.toMatchObject({ code: 'request_too_large' });
  });
});
