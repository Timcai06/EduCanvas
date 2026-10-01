import { describe, expect, it } from 'vitest';
import {
  DEEP_RESEARCH_UNAVAILABLE_MESSAGE,
  messageForPublicError,
  readPublicError,
} from './public-error';

describe('public error messages', () => {
  it.each([
    ['asset_not_available', '附件不可访问，请移除失效来源或重新上传后发送。'],
    [
      'unsupported_asset_modality',
      '当前模型无法读取这类附件，请改用提取文本或受支持的文件。',
    ],
    [
      'native_asset_budget_exceeded',
      '本轮图片数量或大小超过限制，请减少图片后发送。',
    ],
  ])('附件错误 %s 给出恢复动作且不引导原样重发', async (code, message) => {
    const response = new Response(
      JSON.stringify({ error: { code, requestId: 'request-assets' } }),
      { status: 422 },
    );
    await expect(
      readPublicError(response, 'AI 暂时无法连接，请稍后重试。'),
    ).resolves.toEqual({
      code,
      requestId: 'request-assets',
      message,
      retryable: false,
    });
  });
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
