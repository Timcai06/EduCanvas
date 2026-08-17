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

  it('兼容旧 Canvas 别名并归一化为 canonical outputPreference', async () => {
    await expect(
      parseTeachingTurnRequest(
        request(
          JSON.stringify({
            clientMessageId: 'msg-canvas-1',
            text: '帮我整理成思维导图',
            outputPreference: 'canvas',
          }),
        ),
      ),
    ).resolves.toMatchObject({ outputPreference: 'interactive_artifact' });
  });

  it('接受可选 deep_research 模式并默认保持普通对话', async () => {
    await expect(
      parseTeachingTurnRequest(
        request(
          JSON.stringify({
            clientMessageId: 'msg-research-1',
            text: '光合作用的研究进展',
            mode: 'deep_research',
          }),
        ),
      ),
    ).resolves.toMatchObject({ mode: 'deep_research' });

    await expect(
      parseTeachingTurnRequest(
        request(
          JSON.stringify({
            clientMessageId: 'msg-research-2',
            text: '绕过权限',
            mode: 'root',
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('接受 provider-neutral outputPreference 枚举并拒绝不可信值', async () => {
    await expect(
      parseTeachingTurnRequest(
        request(
          JSON.stringify({
            clientMessageId: 'msg-markdown-1',
            text: '写一个小结',
            outputPreference: 'markdown_document',
          }),
        ),
      ),
    ).resolves.toMatchObject({ outputPreference: 'markdown_document' });

    await expect(
      parseTeachingTurnRequest(
        request(
          JSON.stringify({
            clientMessageId: 'msg-web-app-1',
            text: '做一个 Web 小玩具',
            outputPreference: 'web_app',
          }),
        ),
      ),
    ).resolves.toMatchObject({ outputPreference: 'web_app' });

    await expect(
      parseTeachingTurnRequest(
        request(
          JSON.stringify({
            clientMessageId: 'msg-canvas-2',
            text: '帮我整理',
            outputPreference: 'root.shell',
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });

    await expect(
      parseTeachingTurnRequest(
        request(
          JSON.stringify({
            clientMessageId: 'msg-canvas-3',
            text: '帮我整理',
            outputPreference: 'AUTO',
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });

    await expect(
      parseTeachingTurnRequest(
        request(
          JSON.stringify({
            clientMessageId: 'msg-canvas-4',
            text: '帮我整理',
            outputPreference: null,
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

  it('在 JSON 解析前拒绝超过 64KiB 的正文', async () => {
    await expect(
      parseTeachingTurnRequest(request('x'.repeat(65_537))),
    ).rejects.toMatchObject({ code: 'request_too_large' });
  });
});
