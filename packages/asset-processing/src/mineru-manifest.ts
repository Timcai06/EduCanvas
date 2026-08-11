import { createHash } from 'node:crypto';
import { imageMimeType } from './mineru-validate';
import { MINERU_MD_FILENAME } from './mineru-zip';
import type { MineruZipEntry } from './mineru-zip';

/**
 * MinerU 派生表示的 manifest（ADR-0026 决定 3）：每张派生图片记录受控
 * 相对路径、内容 hash、MIME、字节大小与顺序/位置元数据，让派生目录可
 * 验证、可审计。manifest 本身与 index.md、images/ 同目录存储，C 阶段
 * 链接重写与 D 阶段鉴权资源路由都从这里读取图片元数据。
 *
 * 只描述 C2 白名单校验后的条目——容器内未声明文件不会出现在这里。
 */

/** 图片在 zip 条目中的出现顺序（稳定、可复验的"位置"元数据）。 */
export type MineruManifestImage = {
  relativePath: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
  position: number;
};

export type MineruManifest = {
  schemaVersion: 1;
  producer: 'mineru';
  markdown: {
    relativePath: string;
    sha256: string;
    byteSize: number;
    mimeType: 'text/markdown';
  };
  images: MineruManifestImage[];
};

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * 生成派生表示的 manifest。纯函数，幂等：同一输入产生同一输出。
 */
export function buildMineruManifest(input: {
  markdown: MineruZipEntry;
  images: MineruZipEntry[];
}): MineruManifest {
  return {
    schemaVersion: 1,
    producer: 'mineru',
    markdown: {
      relativePath: MINERU_MD_FILENAME,
      sha256: sha256Hex(input.markdown.bytes),
      byteSize: input.markdown.bytes.byteLength,
      mimeType: 'text/markdown',
    },
    images: input.images.map((entry, position) => ({
      relativePath: entry.name,
      sha256: sha256Hex(entry.bytes),
      byteSize: entry.bytes.byteLength,
      /* 白名单校验已保证 mimeType 非空（imageMimeType 只会收到白名单扩展名）。 */
      mimeType: imageMimeType(entry.name) ?? 'application/octet-stream',
      position,
    })),
  };
}
