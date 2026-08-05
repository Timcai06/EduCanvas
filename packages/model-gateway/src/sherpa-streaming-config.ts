/**
 * 实时流式转录（sherpa WASM 本地草稿）的显式配置解析（V09-D）。
 *
 * 与 MODEL_GATEWAY_* 的 Provider 配置分域：sherpa 是本地 WASM 推理，没有
 * Base URL / API Key，语义上不属于 OpenAI-compatible 供应商，因此独立前缀
 * `STREAMING_TRANSCRIPTION_*`，避免把「本地模型目录」误当成云端端点配置。
 *
 * ## 默认关闭
 *
 * `STREAMING_TRANSCRIPTION_ENABLED` 缺省为 false：未显式启用时解析结果是
 * disabled，resolver 一律返回 unavailable，语音能力不注册（ADR-0018 的
 * 「模型文件不进仓库、未配置时能力不注册」纪律）。
 *
 * ## 无隐式默认目录
 *
 * 启用时必须显式声明 `STREAMING_TRANSCRIPTION_MODEL_DIR`：不提供任何默认
 * 模型目录，因为模型权重不进仓库、部署机路径由部署方声明。`PROFILE` 必须是
 * manifest 白名单内的 profile（480ms / 1920ms），未知 profile 显式拒绝。
 *
 * ## 浏览器不可覆盖
 *
 * 本模块只从服务端环境 Record 解析；resolver 不接受任何请求参数，浏览器
 * 无法通过请求覆盖 profile、模型目录或热词路径。
 *
 * 本模块不读取文件系统、不校验模型文件存在性（那是 resolver 闸门的职责），
 * 只做「配置是否完整且形状合法」的纯解析。
 */
import { isAbsolute } from 'node:path';
import { trimmed, type ModelGatewayEnvironment } from './config-primitives';

/** 实时流式配置的稳定错误码；与既有 ModelGatewayConfigurationErrorCode 分域。 */
export const sherpaStreamingConfigurationErrorCodes = [
  'INVALID_STREAMING_ENABLED',
  'MISSING_STREAMING_PROFILE',
  'INVALID_STREAMING_PROFILE',
  'MISSING_STREAMING_MODEL_DIR',
  'INVALID_STREAMING_MODEL_DIR',
  'INVALID_STREAMING_SESSION_TIMEOUT',
  'INVALID_STREAMING_HOTWORDS_PATH',
] as const;

export type SherpaStreamingConfigurationErrorCode =
  (typeof sherpaStreamingConfigurationErrorCodes)[number];

/** 配置异常只暴露稳定码，不携带路径、Secret 或原始环境变量。 */
export class SherpaStreamingConfigurationError extends Error {
  override readonly name = 'SherpaStreamingConfigurationError';

  constructor(readonly code: SherpaStreamingConfigurationErrorCode) {
    super(code);
  }
}

/** manifest 白名单内的 profile 标识；未知 profile 由 resolver 在 manifest 层拒绝。 */
export const sherpaStreamingProfiles = ['480ms', '1920ms'] as const;
export type SherpaStreamingProfile = (typeof sherpaStreamingProfiles)[number];

/** 已启用状态的完整配置；模型目录是部署机绝对路径，不做隐式默认。 */
export interface EnabledSherpaStreamingConfiguration {
  enabled: true;
  /** manifest 白名单内的 profile 标识（480ms / 1920ms）；未知值由 resolver 拒绝。 */
  profile: string;
  /** 解压后模型目录的绝对路径（含目录名），由部署方显式声明。 */
  modelDirectory: string;
  /** 热词词表路径；null 表示未启用热词。 */
  hotwordsPath: string | null;
  /** 会话级兜底超时毫秒数，透传给 V08 Gateway 的 timeoutMs。 */
  sessionTimeoutMs: number;
}

/** 未启用状态的配置；不携带任何路径信息，避免误用。 */
export interface DisabledSherpaStreamingConfiguration {
  enabled: false;
}

export type SherpaStreamingConfiguration =
  EnabledSherpaStreamingConfiguration | DisabledSherpaStreamingConfiguration;

/**
 * 环境变量名常量。集中声明便于 env-check 与文档保持一致，防止拼写漂移。
 */
export const sherpaStreamingEnvNames = {
  enabled: 'STREAMING_TRANSCRIPTION_ENABLED',
  profile: 'STREAMING_TRANSCRIPTION_PROFILE',
  modelDir: 'STREAMING_TRANSCRIPTION_MODEL_DIR',
  hotwordsPath: 'STREAMING_TRANSCRIPTION_HOTWORDS_PATH',
  sessionTimeoutMs: 'STREAMING_TRANSCRIPTION_SESSION_TIMEOUT_MS',
} as const;

/** 会话超时合法区间：1 秒到 10 分钟，防止 0 或天文数字拖垮会话。 */
export const sherpaStreamingSessionTimeoutBounds = {
  min: 1_000,
  max: 600_000,
} as const;

const parseProfile = (value: string | undefined): string => {
  if (value === undefined || value.trim() === '') {
    throw new SherpaStreamingConfigurationError('MISSING_STREAMING_PROFILE');
  }
  // 配置层只做形状校验（非空、长度、无控制字符）；profile 是否在白名单内
  // 由 resolver 查 manifest 决定（V09-B：manifest 是只读白名单，未知 profile
  // 显式拒绝 → unknown_profile），避免配置层与 manifest 双份白名单漂移。
  if (value.length > 64 || /[\r\n\t\0]/.test(value)) {
    throw new SherpaStreamingConfigurationError('INVALID_STREAMING_PROFILE');
  }
  return value;
};

const parseModelDirectory = (value: string | undefined): string => {
  const dir = trimmed(value);
  if (dir === undefined) {
    throw new SherpaStreamingConfigurationError('MISSING_STREAMING_MODEL_DIR');
  }
  // 模型目录是部署机路径，禁止换行等不可见字符注入日志或工具调用。
  if (dir.length > 1024 || /[\r\n\t\0]/.test(dir) || !isAbsolute(dir)) {
    throw new SherpaStreamingConfigurationError('INVALID_STREAMING_MODEL_DIR');
  }
  return dir;
};

/** 有界整数解析：复用与既有 parseBoundedInteger 相同的形状约束，但抛本域错误码。 */
const parseSessionTimeoutMs = (value: string | undefined): number => {
  if (value === undefined || value.trim() === '') return 60_000;
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < sherpaStreamingSessionTimeoutBounds.min ||
    parsed > sherpaStreamingSessionTimeoutBounds.max
  ) {
    throw new SherpaStreamingConfigurationError(
      'INVALID_STREAMING_SESSION_TIMEOUT',
    );
  }
  return parsed;
};

/**
 * 从显式环境 Record 解析实时流式配置。disabled（默认）不抛异常；enabled
 * 但形状不完整/非法时抛稳定码配置异常，由调用方（resolver）归一化为不可用。
 */
export function parseSherpaStreamingConfiguration(
  environment: ModelGatewayEnvironment,
): SherpaStreamingConfiguration {
  const rawEnabled = trimmed(environment[sherpaStreamingEnvNames.enabled]);
  if (rawEnabled === undefined || rawEnabled === '') return { enabled: false };
  if (rawEnabled !== 'true' && rawEnabled !== 'false') {
    throw new SherpaStreamingConfigurationError('INVALID_STREAMING_ENABLED');
  }
  if (rawEnabled === 'false') return { enabled: false };

  const rawProfile = trimmed(environment[sherpaStreamingEnvNames.profile]);
  if (rawProfile === undefined) {
    throw new SherpaStreamingConfigurationError('MISSING_STREAMING_PROFILE');
  }
  const profile = parseProfile(rawProfile);

  const modelDirectory = parseModelDirectory(
    environment[sherpaStreamingEnvNames.modelDir],
  );
  const rawHotwords = trimmed(
    environment[sherpaStreamingEnvNames.hotwordsPath],
  );
  const hotwordsPath =
    rawHotwords === undefined || rawHotwords.length === 0 ? null : rawHotwords;
  if (hotwordsPath !== null) {
    // 热词路径非法（超长/控制字符）按形状错误拒绝：路径是部署方声明的文件
    // 位置，不能含换行等注入字符；存在性由 resolver 闸门校验。
    if (
      hotwordsPath.length > 1024 ||
      /[\r\n\t\0]/.test(hotwordsPath) ||
      !isAbsolute(hotwordsPath)
    ) {
      throw new SherpaStreamingConfigurationError(
        'INVALID_STREAMING_HOTWORDS_PATH',
      );
    }
  }

  const sessionTimeoutMs = parseSessionTimeoutMs(
    environment[sherpaStreamingEnvNames.sessionTimeoutMs],
  );

  return {
    enabled: true,
    profile: rawProfile,
    modelDirectory,
    hotwordsPath,
    sessionTimeoutMs,
  };
}
