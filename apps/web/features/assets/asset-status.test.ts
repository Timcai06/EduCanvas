import { describe, expect, it } from 'vitest';
import {
  assetFailureMessage,
  assetProcessingMessage,
  detectAssetStatusNotices,
  type AssetStatusView,
} from './asset-status';

function asset(
  status: AssetStatusView['status'],
  failureCode: string | null = null,
): AssetStatusView {
  return {
    id: 'asset-1',
    label: '课程讲义.pdf',
    status,
    processing: {
      failureCode,
      createdAt: '2026-07-26T08:00:00.000Z',
    },
  };
}

describe('来源处理状态文案', () => {
  it('只为刚刚完成或失败的来源生成一次通知', () => {
    expect(
      detectAssetStatusNotices([asset('processing')], [asset('ready')]),
    ).toEqual([
      {
        assetId: 'asset-1',
        tone: 'success',
        message: '“课程讲义.pdf”已处理完成，可以用于对话。',
      },
    ]);
    expect(
      detectAssetStatusNotices(
        [asset('processing')],
        [asset('failed', 'pdf_text_unavailable')],
      ),
    ).toEqual([
      {
        assetId: 'asset-1',
        tone: 'error',
        message: '“课程讲义.pdf”处理失败：PDF没有可提取的文字，可能是扫描件。',
      },
    ]);
    expect(detectAssetStatusNotices([], [asset('failed')])).toEqual([]);
  });

  it('未知失败码不进入用户文案', () => {
    expect(assetFailureMessage('private_stack_or_provider_body')).toBe(
      '文件处理失败',
    );
  });

  it('长时间处理中给出明确提示', () => {
    expect(
      assetProcessingMessage(
        '2026-07-26T08:00:00.000Z',
        Date.parse('2026-07-26T08:03:00.000Z'),
      ),
    ).toBe('处理时间较长，可稍后刷新或重新上传');
  });
});
