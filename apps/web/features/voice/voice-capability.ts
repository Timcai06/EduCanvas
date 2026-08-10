/**
 * 语音能力闸门（V17-B）— 受控 VoiceCapabilityState 纯逻辑。
 *
 * ## 职责
 *
 * 完整 V17 的语音入口（短句/字幕）只有在全部前置能力健康时才显示；本模块
 * 把实时识别所需的两项基础设施检查折叠成单一、确定性的判定结果，
 * **fail closed**：
 *
 * - model / connection 任一 **缺失、false、重复或非法（未知键）** →
 *   `enabled === false`；
 * - 缺失维度视为不健康（两项必须全部显式声明且健康才放行）；重复键或未知
 *   键视为配置非法，整体禁用为 `CAPABILITY_CONFIG_INVALID`；
 * - `reason` 是第一个（按声明顺序）不健康项的稳定码，`unhealthy` 列出全部
 *   不健康项（顺序稳定），供 UI 显示可读原因；
 * - 纯函数：无 I/O、无 React、无浏览器 API，SSR 安全；能力检查的真实来源
 *   （服务端配置/健康探测）由完整 V17 注入，本模块只做折叠判定。
 * - 本路径只处理不落盘的实时 PCM；任何原始音频留存仍必须走 V11/V14/V15
 *   的同意、留存和删除契约，不能借本闸门绕过。
 *
 * ## 纪律
 *
 * - 原因码与可读文案都是稳定字符串（不得拼接服务端消息、错误对象或堆栈）；
 * - 任何输入错误都收敛为禁用（fail closed），绝不静默放行；
 * - 不保存任何 PCM、文本、ticket 或凭证。
 */

/** 能力键：声明顺序即判定优先级与 `unhealthy` 顺序。 */
export type VoiceCapabilityKey = 'model' | 'connection';

/** 稳定原因码：UI 据此显示可读文案，不携带服务端细节。 */
export type VoiceCapabilityReason =
  | 'MODEL_UNAVAILABLE'
  | 'CONNECTION_UNAVAILABLE'
  /** 配置非法（重复键/未知键）：fail closed，不携带原始输入。 */
  | 'CAPABILITY_CONFIG_INVALID';

/** 单维健康检查输入。 */
export interface VoiceCapabilityCheck {
  readonly key: VoiceCapabilityKey;
  readonly healthy: boolean;
}

/** 判定结果：入口是否可用 + 稳定原因。 */
export interface VoiceCapabilityState {
  readonly enabled: boolean;
  /** 第一个不健康项的稳定原因；全部健康时为 null。 */
  readonly reason: VoiceCapabilityReason | null;
  /** 全部不健康项的稳定原因（按声明顺序）。 */
  readonly unhealthy: readonly VoiceCapabilityReason[];
}

const CAPABILITY_ORDER: readonly VoiceCapabilityKey[] = ['model', 'connection'];

const REASON_BY_KEY: Readonly<
  Record<VoiceCapabilityKey, VoiceCapabilityReason>
> = {
  model: 'MODEL_UNAVAILABLE',
  connection: 'CONNECTION_UNAVAILABLE',
};

/**
 * 折叠实时识别基础设施检查为入口判定（fail closed）。
 *
 * - 重复键 / 未知键：配置非法，整体禁用（`CAPABILITY_CONFIG_INVALID`）；
 * - 缺失的维度视为不健康（必须两项全部显式声明且健康才放行）；
 * - 任一维度 `healthy === false` 禁用。
 */
export function evaluateVoiceCapability(
  checks: readonly VoiceCapabilityCheck[],
): VoiceCapabilityState {
  const seen = new Set<VoiceCapabilityKey>();
  for (const check of checks) {
    const known = (CAPABILITY_ORDER as readonly string[]).includes(check.key);
    if (!known || seen.has(check.key)) {
      return {
        enabled: false,
        reason: 'CAPABILITY_CONFIG_INVALID',
        unhealthy: ['CAPABILITY_CONFIG_INVALID'],
      };
    }
    seen.add(check.key);
  }
  const unhealthy: VoiceCapabilityReason[] = [];
  for (const key of CAPABILITY_ORDER) {
    const healthy = checks.some((check) => check.key === key && check.healthy);
    if (!healthy) unhealthy.push(REASON_BY_KEY[key]);
  }
  return {
    enabled: unhealthy.length === 0,
    reason: unhealthy[0] ?? null,
    unhealthy,
  };
}

/** 稳定可读文案（面向 K12 用户）；原因码是稳定的，文案只在此映射。 */
export function voiceCapabilityReasonLabel(
  reason: VoiceCapabilityReason,
): string {
  switch (reason) {
    case 'MODEL_UNAVAILABLE':
      return '语音模型暂不可用';
    case 'CONNECTION_UNAVAILABLE':
      return '实时语音连接暂不可用';
    case 'CAPABILITY_CONFIG_INVALID':
      return '语音能力配置无效';
  }
}
