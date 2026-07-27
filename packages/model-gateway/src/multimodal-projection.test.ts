import type { StreamAgentTextRequest } from '@educanvas/agent-core';
import { describe, expect, it } from 'vitest';
import { buildAiSdkPrompt, AiSdkProtocolError } from './ai-sdk-protocol';
import { OpenAICompatibleTurnModelGateway } from './openai-compatible-turn-model-gateway';
import {
  answerRequest,
  collect,
  config,
  oneResponseFetch,
} from './openai-compatible-turn-model-gateway.test-support';
import {
  createFixtureResponse,
  textStreamChunks,
} from './testing/openai-compatible-fixtures';

const PNG_BASE64 = 'iVBORw0KGgo=';

const imageRequest: StreamAgentTextRequest = {
  ...answerRequest,
  messages: [
    { role: 'system', content: '你是AI老师。' },
    {
      role: 'user',
      content: [
        { type: 'text', text: '这张图里是什么？' },
        { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
      ],
    },
  ],
};

async function capturedBody(
  request: StreamAgentTextRequest,
): Promise<{ messages: { role: string; content: unknown }[] }> {
  let init: RequestInit | undefined;
  const gateway = new OpenAICompatibleTurnModelGateway(config, {
    fetchImpl: oneResponseFetch(
      () => createFixtureResponse(textStreamChunks, { splitEvery: 7 }),
      (_input, capturedInit) => {
        init = capturedInit;
      },
    ),
    now: () => 100,
  });
  await collect(gateway, request);
  return JSON.parse(String(init?.body)) as {
    messages: { role: string; content: unknown }[];
  };
}

describe('原生图片输入的供应商投影', () => {
  it('native Adapter 把图片内联成 data URL，不泄露任何内部地址', async () => {
    const body = await capturedBody(imageRequest);

    expect(body.messages.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '这张图里是什么？' },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${PNG_BASE64}` },
        },
      ],
    });
  });

  it('纯文本请求的线上形状一字不变', async () => {
    /* content 契约放宽后，既有纯文本请求绝不能被改写成片段数组——
       那会让所有 OpenAI-compatible 供应商看到一个不同的请求体。 */
    const body = await capturedBody(answerRequest);

    expect(body.messages).toEqual([
      { role: 'system', content: '你是AI老师。' },
      { role: 'user', content: '猫和狗有什么不同？' },
    ]);
  });

  it('AI SDK Adapter 投影为 image part 并保留 mediaType', () => {
    const prompt = buildAiSdkPrompt(imageRequest);

    expect(prompt.instructions).toBe('你是AI老师。');
    expect(prompt.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '这张图里是什么？' },
          { type: 'image', image: PNG_BASE64, mediaType: 'image/png' },
        ],
      },
    ]);
  });

  it('AI SDK Adapter 拒绝带非文本片段的 assistant 消息', () => {
    /* 原生模态只从用户侧进入；assistant 侧出现图片说明上游拼错了，
       静默丢弃会让重放与审计对不上。 */
    expect(() =>
      buildAiSdkPrompt({
        ...answerRequest,
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
            ],
          },
        ],
      }),
    ).toThrow(AiSdkProtocolError);
  });
});
