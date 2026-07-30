import {
  ModelGatewayInvocationError,
  supportedGeneratedImageMimeTypes,
  supportedGeneratedImageSizes,
  type GeneratedImage,
  type ImageGenerationModelGateway,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type NormalizedModelError,
  type ProviderCallMetadata,
  type SupportedGeneratedImageMimeType,
} from '@educanvas/agent-core';
import type { EnabledModelGatewayConfiguration } from './config';

export interface OpenAICompatibleImageGenerationModelGatewayOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** 提示词长度上界；超出即在发出请求前拒绝，不把无界文本交给供应商计费。 */
const MAX_PROMPT_CHARACTERS = 4_000;

const invocationError = (
  normalized: NormalizedModelError,
  cause?: unknown,
): ModelGatewayInvocationError =>
  new ModelGatewayInvocationError(normalized, { cause });

const errorForHttpStatus = (status: number): NormalizedModelError => {
  if (status === 429) return { code: 'rate_limit', retryable: true };
  if (status >= 500) return { code: 'unavailable', retryable: true };
  return { code: 'invalid_response', retryable: false };
};

/**
 * 魔术字节前缀表。供应商声称的格式一律不可信：位图容器头是这里唯一的判据，
 * 因为渲染端只按白名单 MIME 展示，若声明与实际内容不一致就会出现「按图片
 * 渲染实为其他内容」的偏差。WebP 需要同时匹配 RIFF 头与 WEBP 标记。
 */
const IMAGE_MAGIC_PREFIXES: Readonly<
  Record<SupportedGeneratedImageMimeType, readonly number[]>
> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};

const WEBP_MARKER = [0x57, 0x45, 0x42, 0x50] as const;

const startsWith = (
  bytes: Uint8Array,
  prefix: readonly number[],
  offset = 0,
): boolean =>
  bytes.byteLength >= offset + prefix.length &&
  prefix.every((byte, index) => bytes[offset + index] === byte);

/** 只按容器魔术字节判定 MIME；无法确定即返回 null，不做「大概是 PNG」的猜测。 */
function sniffImageMimeType(
  bytes: Uint8Array,
): SupportedGeneratedImageMimeType | null {
  for (const mimeType of supportedGeneratedImageMimeTypes) {
    if (!startsWith(bytes, IMAGE_MAGIC_PREFIXES[mimeType])) continue;
    if (mimeType === 'image/webp' && !startsWith(bytes, WEBP_MARKER, 8)) {
      continue;
    }
    return mimeType;
  }
  return null;
}

/**
 * 严格 base64 校验后解码。先按字符集与长度做常数级检查，避免把畸形或超大
 * 字符串直接喂给解码器再事后补救内存。
 */
function decodeBoundedBase64(
  value: string,
  maxBytes: number,
): Uint8Array | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const byteLength = (value.length / 4) * 3 - padding;
  if (byteLength <= 0 || byteLength > maxBytes) return null;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.byteLength === byteLength ? new Uint8Array(decoded) : null;
  } catch {
    return null;
  }
}

/**
 * OpenAI-compatible `/images/generations` 适配器。一次请求生成单张图像，
 * 不做内部重试；调用方决定失败终态，避免超时或限流时静默重复计费。
 *
 * 供应商原始响应止步于此：返回值只含已通过魔术字节复核的字节与审计元数据，
 * 不含响应体、URL、Prompt 或凭据。响应里的 `url` 形态一律拒绝——回源下载会
 * 让内容事实依赖供应商临时链接的有效期，而 Artifact Version 必须自持。
 */
export class OpenAICompatibleImageGenerationModelGateway implements ImageGenerationModelGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly config: EnabledModelGatewayConfiguration,
    options: OpenAICompatibleImageGenerationModelGatewayOptions = {},
  ) {
    if (!config.modelIds.image) {
      throw new TypeError('image model alias 未配置');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async generateImage(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult> {
    const prompt = request.prompt.trim();
    if (
      prompt.length === 0 ||
      prompt.length > MAX_PROMPT_CHARACTERS ||
      request.count !== 1 ||
      !supportedGeneratedImageSizes.includes(request.size)
    ) {
      throw invocationError({ code: 'output_limit', retryable: false });
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.imageTimeoutMs);
    const onExternalAbort = () => controller.abort();
    if (request.signal?.aborted === true) controller.abort();
    else
      request.signal?.addEventListener('abort', onExternalAbort, {
        once: true,
      });

    const modelId = this.config.modelIds.image!;
    const startedAt = this.now();
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(
          `${this.config.baseUrl}/images/generations`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${this.config.apiKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: modelId,
              prompt,
              size: request.size,
              n: request.count,
              response_format: 'b64_json',
            }),
            signal: controller.signal,
          },
        );
      } catch (cause) {
        if (timedOut) {
          throw invocationError({ code: 'timeout', retryable: true }, cause);
        }
        if (request.signal?.aborted === true) {
          throw invocationError({ code: 'aborted', retryable: false }, cause);
        }
        throw invocationError({ code: 'unavailable', retryable: true }, cause);
      }

      if (!response.ok) {
        throw invocationError(errorForHttpStatus(response.status));
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (cause) {
        throw invocationError(
          { code: 'invalid_response', retryable: false },
          cause,
        );
      }

      const image = this.readSingleImage(body, request.size);
      const metadata: ProviderCallMetadata = {
        providerResponseId: response.headers.get('x-request-id'),
        provider: this.config.provider,
        taskAlias: request.taskAlias,
        modelAlias: request.modelAlias,
        resolvedModelId: modelId,
        modelRevision: null,
        systemFingerprint: null,
        finishReason: 'stop',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheHitTokens: 0,
          reasoningTokens: 0,
        },
        latencyMs: Math.max(0, this.now() - startedAt),
        traceId: request.traceId,
      };
      return { images: [image], metadata };
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  /** 供应商响应按最窄形状解析：多返回的条目、URL 形态和未知格式一律拒绝。 */
  private readSingleImage(
    body: unknown,
    size: ImageGenerationRequest['size'],
  ): GeneratedImage {
    if (typeof body !== 'object' || body === null) {
      throw invocationError({ code: 'invalid_response', retryable: false });
    }
    const data = (body as Record<string, unknown>).data;
    if (!Array.isArray(data) || data.length !== 1) {
      throw invocationError({ code: 'invalid_response', retryable: false });
    }
    const entry = data[0];
    if (typeof entry !== 'object' || entry === null) {
      throw invocationError({ code: 'invalid_response', retryable: false });
    }
    const encoded = (entry as Record<string, unknown>).b64_json;
    if (typeof encoded !== 'string') {
      throw invocationError({ code: 'invalid_response', retryable: false });
    }
    const bytes = decodeBoundedBase64(encoded, this.config.imageMaxOutputBytes);
    if (!bytes) {
      throw invocationError({ code: 'output_limit', retryable: false });
    }
    const mimeType = sniffImageMimeType(bytes);
    if (!mimeType) {
      throw invocationError({ code: 'invalid_response', retryable: false });
    }
    return { bytes, mimeType, size };
  }
}
