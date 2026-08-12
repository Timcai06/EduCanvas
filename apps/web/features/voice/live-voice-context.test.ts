import { describe, expect, it } from 'vitest';
import {
  MAX_LIVE_CONTEXT_ASSETS,
  freezeLiveVoiceContext,
  liveVoiceAssetStatusLabel,
  type LiveVoiceContextAsset,
} from './live-voice-context';

const assets: readonly LiveVoiceContextAsset[] = [
  {
    id: 'image-1',
    versionId: 'image-version-1',
    label: '函数图像.png',
    kind: 'image',
    scope: 'space',
    status: 'ready',
    enabled: true,
    selectable: true,
  },
  {
    id: 'doc-1',
    versionId: null,
    label: '讲义.pdf',
    kind: 'document',
    scope: 'turn',
    status: 'processing',
    enabled: true,
    selectable: false,
  },
];

describe('Live Voice context snapshot', () => {
  it('只冻结已启用且 ready 的不可变版本，避免后续 UI 变更漂移', () => {
    const snapshot = freezeLiveVoiceContext(assets, 42);
    expect(snapshot).toEqual({ capturedAt: 42, assets: [assets[0]] });
    expect(snapshot.assets).not.toBe(assets);
  });

  it('处理中的资料明确说明本轮不会静默带入', () => {
    expect(liveVoiceAssetStatusLabel(assets[1]!)).toBe('处理中 · 本轮暂不带入');
    expect(liveVoiceAssetStatusLabel(assets[0]!)).toBe('长期上下文');
  });

  it('与普通 Turn 共用五类 Source、去重和 63 项硬上限', () => {
    const many = Array.from(
      { length: MAX_LIVE_CONTEXT_ASSETS + 2 },
      (_, index) => ({
        ...assets[0]!,
        id: `source-${index}`,
        versionId: `version-${index}`,
        kind: (['image', 'document', 'link', 'audio', 'video'] as const)[
          index % 5
        ]!,
      }),
    );
    expect(freezeLiveVoiceContext(many, 42).assets).toHaveLength(
      MAX_LIVE_CONTEXT_ASSETS,
    );
    expect(
      freezeLiveVoiceContext([many[0]!, many[0]!], 42).assets,
    ).toHaveLength(1);
  });
});
