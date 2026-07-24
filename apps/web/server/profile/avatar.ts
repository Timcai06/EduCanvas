import 'server-only';

/** 头像内容不满足大小或受支持格式边界。 */
export class AvatarUploadError extends Error {
  constructor(readonly code: 'avatar_too_large' | 'unsupported_avatar_type') {
    super(code);
    this.name = 'AvatarUploadError';
  }
}

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** 只从受限字节内容识别 PNG/JPEG/WebP，不信任浏览器 MIME 声明。 */
export function detectAvatarImage(
  bytes: Uint8Array,
):
  | { mimeType: 'image/png'; extension: 'png' }
  | { mimeType: 'image/jpeg'; extension: 'jpg' }
  | { mimeType: 'image/webp'; extension: 'webp' } {
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
    throw new AvatarUploadError('avatar_too_large');
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
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  throw new AvatarUploadError('unsupported_avatar_type');
}

/** 将内部头像校验 code 映射为稳定中文公开文案。 */
export function avatarUploadErrorMessage(error: AvatarUploadError): string {
  return error.code === 'avatar_too_large'
    ? '头像不能超过 2MB。'
    : '头像只支持 PNG、JPEG 或 WebP。';
}
