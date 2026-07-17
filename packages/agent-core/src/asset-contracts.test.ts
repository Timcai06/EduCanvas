import { describe, expect, it } from 'vitest';
import {
  assetDescriptorSchema,
  assetVersionDescriptorSchema,
  canTransitionAssetStatus,
} from './asset-contracts';

describe('generic asset contracts', () => {
  it('描述与课程无关的全模态资产和不可变版本', () => {
    expect(
      assetDescriptorSchema.parse({
        assetId: 'asset.image.1',
        scope: 'space',
        kind: 'image',
        origin: 'upload',
        displayName: '显微镜照片.png',
        mimeType: 'image/png',
        status: 'ready',
        currentVersionId: 'version.image.1',
      }),
    ).toMatchObject({ kind: 'image', scope: 'space' });

    expect(
      assetVersionDescriptorSchema.safeParse({
        assetId: 'asset.video.1',
        versionId: 'version.video.1',
        kind: 'video',
        mimeType: 'video/mp4',
        byteSize: 1_024,
        contentHash: 'a'.repeat(64),
        status: 'processing',
      }).success,
    ).toBe(true);
  });

  it('不允许对象地址和垂直教学字段泄漏到资产描述', () => {
    const base = {
      assetId: 'asset-1',
      scope: 'turn',
      kind: 'document',
      origin: 'upload',
      displayName: '资料.pdf',
      mimeType: 'application/pdf',
      status: 'pending',
      currentVersionId: null,
    } as const;
    expect(
      assetDescriptorSchema.safeParse({
        ...base,
        objectUrl: 'https://storage.example/private.pdf',
      }).success,
    ).toBe(false);
    expect(
      assetDescriptorSchema.safeParse({
        ...base,
        courseSlug: 'ai-literacy',
      }).success,
    ).toBe(false);
  });

  it('由确定性状态机约束资产处理状态', () => {
    expect(canTransitionAssetStatus('pending', 'processing')).toBe(true);
    expect(canTransitionAssetStatus('processing', 'ready')).toBe(true);
    expect(canTransitionAssetStatus('ready', 'processing')).toBe(false);
    expect(canTransitionAssetStatus('tombstoned', 'ready')).toBe(false);
  });
});
