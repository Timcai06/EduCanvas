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
  it('兼容纯文本请求并规范化为结构化消息部件', async () => {
    await expect(
      parseTeachingTurnRequest(
        request(
          JSON.stringify({ clientMessageId: 'msg-1', text: '  为什么？ ' }),
        ),
      ),
    ).resolves.toEqual({
      clientMessageId: 'msg-1',
      text: '为什么？',
      parts: [{ type: 'text', text: '为什么？' }],
    });

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

  it('接受文本与资产引用组成的严格多模态请求', async () => {
    await expect(
      parseTeachingTurnRequest(
        request(
          JSON.stringify({
            clientMessageId: 'msg-assets-1',
            parts: [
              { type: 'text', text: '解释这份资料' },
              {
                type: 'asset_ref',
                reference: {
                  assetId: '11111111-1111-4111-8111-111111111111',
                  versionId: '22222222-2222-4222-8222-222222222222',
                  kind: 'document',
                },
                usage: 'attachment',
              },
            ],
          }),
        ),
      ),
    ).resolves.toEqual({
      clientMessageId: 'msg-assets-1',
      text: '解释这份资料',
      parts: [
        { type: 'text', text: '解释这份资料' },
        {
          type: 'asset_ref',
          reference: {
            assetId: '11111111-1111-4111-8111-111111111111',
            versionId: '22222222-2222-4222-8222-222222222222',
            kind: 'document',
          },
          usage: 'attachment',
        },
      ],
    });
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

  it('在 JSON 解析前拒绝超过 64KiB 的正文', async () => {
    await expect(
      parseTeachingTurnRequest(request('x'.repeat(65_537))),
    ).rejects.toMatchObject({ code: 'request_too_large' });
  });
});
