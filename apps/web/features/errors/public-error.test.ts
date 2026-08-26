import { describe, expect, it } from 'vitest';
import {
  DEEP_RESEARCH_UNAVAILABLE_MESSAGE,
  messageForPublicError,
  readPublicError,
} from './public-error';

describe('public error messages', () => {
  it('将未配置的深度研究归因到搜索能力，而不是 AI 连接', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          code: 'deep_research_unavailable',
          requestId: 'request-deep-research',
        },
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );

    await expect(
      readPublicError(response, 'AI 暂时无法连接，请稍后重试。'),
    ).resolves.toEqual({
      code: 'deep_research_unavailable',
      requestId: 'request-deep-research',
      message: DEEP_RESEARCH_UNAVAILABLE_MESSAGE,
      retryable: false,
    });
  });

  it('未知错误继续使用调用方提供的安全兜底文案', () => {
    expect(messageForPublicError('unknown_error', '请求失败。')).toBe(
      '请求失败。',
    );
  });
});
