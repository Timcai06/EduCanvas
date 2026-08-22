/**
 * Gateway 桌面上传的文件类型检测（DP10）。
 *
 * 桌面输入边界只放开图片（PNG/JPEG/WebP）与 PDF 文档；与 Web 上传不同，
 * 这里刻意不接收 DOCX/音频/视频等需要更多处理链路的类型。二进制一律
 * 按 magic bytes 判定，绝不信任客户端声明的 MIME 或文件后缀。
 */

export interface DetectedAssetFile {
  kind: 'image' | 'document';
  mimeType: string;
  extension: string;
}

/** 桌面 manifest 声明的可输入图片类型；只读上行，无副作用。 */
export const NATIVE_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export function detectAssetFile(bytes: Uint8Array): DetectedAssetFile | null {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return { kind: 'document', mimeType: 'application/pdf', extension: 'pdf' };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { kind: 'image', mimeType: 'image/png', extension: 'png' };
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { kind: 'image', mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return { kind: 'image', mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}
