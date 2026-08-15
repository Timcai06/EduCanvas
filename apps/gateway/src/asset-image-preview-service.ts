export const MAX_IMAGE_PREVIEW_BYTES = 1_000_000;

const PREVIEW_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export interface GatewayImagePreviewDescriptor {
  storageKey: string;
  mimeType: string;
  byteSize: number;
}

export interface GatewayImagePreview {
  mimeType: string;
  bytes: Buffer;
}

export interface GatewayImagePreviewSource {
  find(input: {
    conversationId: string;
    trustedSubjectId: string;
    assetId: string;
    assetVersionId: string;
  }): Promise<GatewayImagePreviewDescriptor | null>;
}

export class GatewayImagePreviewError extends Error {
  constructor(
    readonly status: 404 | 413 | 415 | 503,
    readonly code:
      | 'NOT_FOUND'
      | 'PREVIEW_TOO_LARGE'
      | 'UNSUPPORTED_MEDIA'
      | 'PREVIEW_UNAVAILABLE',
  ) {
    super(code);
    this.name = 'GatewayImagePreviewError';
  }
}

/**
 * Desktop 图片预览的服务端边界：先从 canonical Conversation Message 重新授权，
 * 再按受限 MIME 和字节上限读取私有对象。storageKey 永不离开 Gateway 进程。
 */
export class GatewayImagePreviewService {
  constructor(
    private readonly dependencies: GatewayImagePreviewSource & {
      readBytes(storageKey: string, maxBytes: number): Promise<Buffer>;
    },
  ) {}

  async read(input: {
    conversationId: string;
    trustedSubjectId: string;
    assetId: string;
    assetVersionId: string;
  }): Promise<GatewayImagePreview> {
    const descriptor = await this.dependencies.find(input);
    if (!descriptor) throw new GatewayImagePreviewError(404, 'NOT_FOUND');
    if (!PREVIEW_MIME_TYPES.has(descriptor.mimeType)) {
      throw new GatewayImagePreviewError(415, 'UNSUPPORTED_MEDIA');
    }
    if (descriptor.byteSize > MAX_IMAGE_PREVIEW_BYTES) {
      throw new GatewayImagePreviewError(413, 'PREVIEW_TOO_LARGE');
    }
    let bytes: Buffer;
    try {
      bytes = await this.dependencies.readBytes(
        descriptor.storageKey,
        MAX_IMAGE_PREVIEW_BYTES,
      );
    } catch (error) {
      if (error instanceof GatewayImagePreviewError) throw error;
      throw new GatewayImagePreviewError(503, 'PREVIEW_UNAVAILABLE');
    }
    if (bytes.byteLength > MAX_IMAGE_PREVIEW_BYTES) {
      throw new GatewayImagePreviewError(413, 'PREVIEW_TOO_LARGE');
    }
    return { mimeType: descriptor.mimeType, bytes };
  }
}
