import { describe, expect, it } from 'vitest';
import { generatedImageMetadataSchema } from './generated-image';

const valid = {
  contentVersion: 1,
  contentType: 'image/png',
  byteSize: 16,
  size: '1024x1024',
  image: {
    provider: 'fixture',
    resolvedModelId: 'image-v1',
    latencyMs: 10,
  },
} as const;

describe('generatedImageMetadataSchema', () => {
  it('接受浏览器安全的图像元数据', () => {
    expect(generatedImageMetadataSchema.parse(valid)).toEqual(valid);
  });

  it('拒绝对象存储 key/checksum 混入公开元数据', () => {
    expect(
      generatedImageMetadataSchema.safeParse({ ...valid, objectKey: 'secret' })
        .success,
    ).toBe(false);
    expect(
      generatedImageMetadataSchema.safeParse({
        ...valid,
        checksum: 'a'.repeat(64),
      }).success,
    ).toBe(false);
  });

  it('只接受白名单位图 MIME 与闭集尺寸', () => {
    expect(
      generatedImageMetadataSchema.safeParse({
        ...valid,
        contentType: 'image/svg+xml',
      }).success,
    ).toBe(false);
    expect(
      generatedImageMetadataSchema.safeParse({ ...valid, size: '4096x4096' })
        .success,
    ).toBe(false);
  });

  it('拒绝 Prompt 或 Provider 原始响应混入公开元数据', () => {
    expect(
      generatedImageMetadataSchema.safeParse({
        ...valid,
        prompt: '完整模型输入',
      }).success,
    ).toBe(false);
    expect(
      generatedImageMetadataSchema.safeParse({
        ...valid,
        providerResponse: { id: 'private' },
      }).success,
    ).toBe(false);
  });
});
