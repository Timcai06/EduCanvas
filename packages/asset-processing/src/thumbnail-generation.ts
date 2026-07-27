/**
 * 缩略图生成模块。
 *
 * 使用 sharp 将图片缩小为指定尺寸的缩略图。对于 PDF，
 * 尝试提取第一页作为图片；如果失败则抛出错误。
 *
 * 依赖：sharp（通过 pnpm workspace 共享）
 */

/**
 * 缩略图尺寸配置。
 */
export const ASSET_THUMBNAIL_MAX_INPUT_BYTES = 10 * 1024 * 1024;

export const THUMBNAIL_CONFIG = {
  /** 缩略图最大宽度（像素）。 */
  maxWidth: 320,
  /** 缩略图最大高度（像素）。 */
  maxHeight: 240,
  /** 缩略图质量（JPEG）。 */
  quality: 80,
  /** 阻止超大像素尺寸图片造成解压缩内存放大。 */
  maxInputPixels: 40_000_000,
} as const;

/**
 * 稳定失败码。它们会落进 `asset_processing_jobs.failure_code`，
 * 并被 HTTP 层映射成用户文案，因此只能追加、不能改写含义。
 */
export const assetThumbnailFailureCodes = [
  /** 图片格式不支持或内容损坏。 */
  'image_processing_failed',
  /** MIME 不在本包的支持范围内。 */
  'unsupported_media_type',
  /** 输入超过服务端缩略图策略上限。 */
  'thumbnail_input_too_large',
] as const;

export type AssetThumbnailFailureCode =
  (typeof assetThumbnailFailureCodes)[number];

export class AssetThumbnailError extends Error {
  override readonly name = 'AssetThumbnailError';

  constructor(
    readonly code: AssetThumbnailFailureCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

/** 支持缩略图生成的 MIME 类型。 */
const SUPPORTED_THUMBNAIL_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

/** 调用方据此判断某个版本要不要排进缩略图队列。 */
export function supportsThumbnailGeneration(mimeType: string): boolean {
  return SUPPORTED_THUMBNAIL_MIME_TYPES.has(mimeType);
}

export interface ThumbnailGenerationResult {
  /** 缩略图字节（JPEG 格式）。 */
  bytes: Uint8Array;
  /** 输出 MIME 类型。 */
  mimeType: 'image/jpeg';
  /** 缩略图宽度。 */
  width: number;
  /** 缩略图高度。 */
  height: number;
}

/**
 * 从已鉴权的不可变版本字节里生成缩略图。
 *
 * 纯函数：不读数据库、不碰对象存储、不做鉴权。调用方负责在调用前完成归属校验，
 * 并把返回值作为新的 thumbnail representation 落库。
 *
 * 失败一律抛 `AssetThumbnailError` 并带稳定码——静默返回空会让上层把
 * 「处理失败」误当成「没有缩略图」。
 */
export async function generateThumbnail(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<ThumbnailGenerationResult> {
  if (!supportsThumbnailGeneration(input.mimeType)) {
    throw new AssetThumbnailError('unsupported_media_type');
  }

  try {
    // 动态导入 sharp 以避免在不需要时加载原生模块
    const sharp = (await import('sharp')).default;

    const image = sharp(Buffer.from(input.bytes), {
      limitInputPixels: THUMBNAIL_CONFIG.maxInputPixels,
      sequentialRead: true,
    });
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw new AssetThumbnailError('image_processing_failed');
    }

    // 计算缩放比例，保持宽高比
    const scale = Math.min(
      THUMBNAIL_CONFIG.maxWidth / metadata.width,
      THUMBNAIL_CONFIG.maxHeight / metadata.height,
      1, // 不放大
    );

    const newWidth = Math.round(metadata.width * scale);
    const newHeight = Math.round(metadata.height * scale);

    const result = await image
      .resize(newWidth, newHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: THUMBNAIL_CONFIG.quality })
      .toBuffer({ resolveWithObject: true });

    return {
      bytes: new Uint8Array(result.data),
      mimeType: 'image/jpeg',
      width: result.info.width,
      height: result.info.height,
    };
  } catch (error) {
    if (error instanceof AssetThumbnailError) {
      throw error;
    }
    throw new AssetThumbnailError('image_processing_failed', { cause: error });
  }
}
