/**
 * 视觉 Provider 配置 — 图片输入专用的独立供应商路由。
 *
 * ## 为什么单独一个 Provider
 *
 * 教学 Turn 的主 Provider（当前开发期是 DeepSeek）只有文本能力：官方模型能力表
 * 没有 vision 项，传 `image_url` 片段会整轮 400。但图片输入是 K12 场景的刚需
 * （拍照提问、看图解题），因此把「文本推理」与「读图」拆成两个 Provider，各自
 * 用自己擅长且真实支持的模型（ADR-0017）。
 *
 * ## 配置即能力
 *
 * 沿用媒体能力的同一条纪律：`MODEL_GATEWAY_VISION_MODEL` 未配置 = 视觉 Provider
 * 不存在，物化层据此明确拒绝图片，而不是运行时再降级。配置了模型就必须同时给出
 * Base URL 与 Key，缺一即配置错误——半配置状态会让部署以为图片可用，直到学生真
 * 传了一张图才在 Turn 中途失败。
 *
 * ## 与主 Provider 的关系
 *
 * 两者互不共享 Base URL 与 Key。`MODEL_GATEWAY_VISION=true`（主 Provider 自身支持
 * 读图）与本文件的独立视觉 Provider 是互斥表达：同时设置说明部署方对「图片走哪
 * 条链路」有两种矛盾预期，直接拒绝而不是替它选一个。
 */

import {
  ModelGatewayConfigurationError,
  parseBoundedInteger,
  parseModelId,
  parseProviderApiKey,
  parseProviderBaseUrl,
  type DeploymentEnvironment,
  type ModelGatewayEnvironment,
} from './config-primitives';

/**
 * 已解析的视觉 Provider。它只服务图片输入这一条链路，因此不带 alias 表：
 * 所有 modelAlias 都解析到同一个视觉模型。
 */
export interface VisionProviderConfiguration {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  timeoutMs: number;
  /**
   * 视觉模型单独设上限而不复用主 Provider 的值：读图任务的输出通常比纯文本
   * 推理短，但上下文里的图片 token 开销高得多，两者的合理预算并不一致。
   */
  maxOutputTokens: number;
}

/**
 * 解析视觉 Provider 配置。
 *
 * @param primaryVisionEnabled 主 Provider 是否已声明自带读图能力；用于互斥校验。
 * @returns 未配置 `MODEL_GATEWAY_VISION_MODEL` 时返回 null，表示视觉能力不存在。
 */
export function parseVisionProviderConfiguration(
  environmentValues: ModelGatewayEnvironment,
  environment: DeploymentEnvironment,
  primaryVisionEnabled: boolean,
): VisionProviderConfiguration | null {
  const modelId = parseModelId(
    environmentValues.MODEL_GATEWAY_VISION_MODEL,
    false,
  );
  if (modelId === undefined) return null;

  /* 两种视觉来源同时声明属于矛盾配置，替部署方猜一个比直接失败更危险。 */
  if (primaryVisionEnabled) {
    throw new ModelGatewayConfigurationError('VISION_PROVIDER_CONFLICT');
  }

  const url = parseProviderBaseUrl(
    environmentValues.MODEL_GATEWAY_VISION_BASE_URL,
    environment,
    { missing: 'MISSING_VISION_BASE_URL', invalid: 'INVALID_VISION_BASE_URL' },
  );

  return {
    baseUrl: url.toString().replace(/\/$/, ''),
    apiKey: parseProviderApiKey(
      environmentValues.MODEL_GATEWAY_VISION_API_KEY,
      {
        missing: 'MISSING_VISION_API_KEY',
        invalid: 'INVALID_VISION_API_KEY',
      },
    ),
    modelId,
    timeoutMs: parseBoundedInteger(
      environmentValues.MODEL_GATEWAY_VISION_TIMEOUT_MS,
      120_000,
      { min: 5_000, max: 300_000 },
      'INVALID_VISION_TIMEOUT',
    ),
    maxOutputTokens: parseBoundedInteger(
      environmentValues.MODEL_GATEWAY_VISION_MAX_OUTPUT_TOKENS,
      2_048,
      { min: 1, max: 65_536 },
      'INVALID_VISION_MAX_OUTPUT_TOKENS',
    ),
  };
}
