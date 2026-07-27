import { detectSupportedAudioSource } from '@educanvas/asset-processing';

export interface DetectedAssetFile {
  kind: 'image' | 'document' | 'audio';
  mimeType: string;
  extension: string;
}

const TEXT_EXTENSIONS: Readonly<
  Record<string, Pick<DetectedAssetFile, 'mimeType' | 'extension'>>
> = {
  '.md': { mimeType: 'text/markdown', extension: 'md' },
  '.markdown': { mimeType: 'text/markdown', extension: 'md' },
  '.txt': { mimeType: 'text/plain', extension: 'txt' },
};

function detectBinaryFile(bytes: Uint8Array): DetectedAssetFile | null {
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
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  ) {
    // ZIP 中央目录的条目名不压缩；同时出现 OOXML 清单和 Word 主文档，
    // 才把容器识别为 DOCX，普通 ZIP 不因文件后缀被误收。
    const signatureWindow = new TextDecoder('latin1').decode(bytes);
    if (
      signatureWindow.includes('[Content_Types].xml') &&
      signatureWindow.includes('word/document.xml')
    ) {
      return {
        kind: 'document',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml',
        extension: 'docx',
      };
    }
  }
  const audio = detectSupportedAudioSource(bytes);
  if (audio) {
    return { kind: 'audio', ...audio };
  }
  return null;
}

function fileExtension(fileName: string): string {
  const normalized = fileName.normalize('NFC').toLowerCase();
  const index = normalized.lastIndexOf('.');
  return index >= 0 ? normalized.slice(index) : '';
}

/**
 * 二进制必须通过魔术字识别；只有没有可靠魔术字的 UTF-8 文本允许后缀白名单。
 * 调用方还必须用严格 TextDecoder 验证文本字节，不能只信浏览器 MIME。
 */
export function detectAssetFile(
  bytes: Uint8Array,
  fileName: string,
): DetectedAssetFile | null {
  const binary = detectBinaryFile(bytes);
  if (binary) return binary;
  const ext = fileExtension(fileName);
  const text = TEXT_EXTENSIONS[ext];
  if (text) return { kind: 'document', ...text };
  return null;
}
