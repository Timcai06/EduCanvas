import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MINERU_MD_FILENAME } from './mineru-zip';
import { buildMineruManifest } from './mineru-manifest';
import type { MineruZipEntry } from './mineru-zip';

const utf8 = (value: string) => new TextEncoder().encode(value);
const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

function md(): MineruZipEntry {
  return { name: MINERU_MD_FILENAME, bytes: utf8('# 光合作用') };
}

describe('buildMineruManifest', () => {
  it('记录 md 与每张图片的相对路径/hash/大小/MIME/位置', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff]);
    const png = new Uint8Array([0x89, 0x50, 0x4e]);
    const manifest = buildMineruManifest({
      markdown: md(),
      images: [
        { name: 'images/001.jpg', bytes: jpg },
        { name: 'images/002.png', bytes: png },
      ],
    });

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.markdown).toEqual({
      relativePath: MINERU_MD_FILENAME,
      sha256: sha(utf8('# 光合作用')),
      byteSize: utf8('# 光合作用').length,
      mimeType: 'text/markdown',
    });
    expect(manifest.images).toEqual([
      {
        relativePath: 'images/001.jpg',
        sha256: sha(jpg),
        byteSize: 3,
        mimeType: 'image/jpeg',
        position: 0,
      },
      {
        relativePath: 'images/002.png',
        sha256: sha(png),
        byteSize: 3,
        mimeType: 'image/png',
        position: 1,
      },
    ]);
  });

  it('无图片时 images 为空数组', () => {
    const manifest = buildMineruManifest({ markdown: md(), images: [] });

    expect(manifest.images).toEqual([]);
  });

  it('manifest 是稳定可 JSON 序列化的结构', () => {
    const manifest = buildMineruManifest({
      markdown: md(),
      images: [{ name: 'images/001.jpg', bytes: new Uint8Array([1]) }],
    });

    const parsed = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
    expect(parsed.images[0]?.position).toBe(0);
    expect(parsed.markdown.mimeType).toBe('text/markdown');
  });
});
