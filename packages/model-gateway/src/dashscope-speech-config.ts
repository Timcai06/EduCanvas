export interface DashScopeSpeechConfiguration {
  readonly apiKey: string;
  readonly workspaceId: string;
  readonly websocketUrl: string;
  readonly asrModel: string;
  readonly dictationModel: string;
  readonly ttsModel: string;
  readonly voice: string;
}

export type DashScopeSpeechResolution =
  | {
      readonly enabled: true;
      readonly configuration: DashScopeSpeechConfiguration;
    }
  | {
      readonly enabled: false;
      readonly reason: 'not_configured' | 'invalid_configuration';
    };

const SAFE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_WORKSPACE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** 只接受北京区域 wss 端点；配置异常不回显环境值。 */
export function parseDashScopeSpeechConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): DashScopeSpeechResolution {
  const apiKey = env.DASHSCOPE_API_KEY?.trim();
  const workspaceId = env.DASHSCOPE_WORKSPACE_ID?.trim();
  if (!apiKey && !workspaceId)
    return { enabled: false, reason: 'not_configured' };
  if (
    !apiKey ||
    apiKey.length < 16 ||
    !workspaceId ||
    !SAFE_WORKSPACE.test(workspaceId)
  ) {
    return { enabled: false, reason: 'invalid_configuration' };
  }
  const websocketUrl =
    env.DASHSCOPE_BEIJING_WS_URL?.trim() ||
    `wss://${workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`;
  const asrModel = env.DASHSCOPE_ASR_MODEL?.trim() || 'paraformer-realtime-v2';
  const dictationModel =
    env.DASHSCOPE_DICTATION_MODEL?.trim() || 'qwen3-asr-flash';
  const hasTtsModel = Boolean(env.DASHSCOPE_TTS_MODEL?.trim());
  const hasTtsVoice = Boolean(env.DASHSCOPE_TTS_VOICE?.trim());
  /* Model 与系统音色构成同一 Provider profile；单边遗留变量不能与
     新默认静默组合成未经验证的配置。 */
  if (hasTtsModel !== hasTtsVoice) {
    return { enabled: false, reason: 'invalid_configuration' };
  }
  const ttsModel =
    env.DASHSCOPE_TTS_MODEL?.trim() || 'qwen-audio-3.0-tts-flash';
  const voice = env.DASHSCOPE_TTS_VOICE?.trim() || 'longanhuan_v3.6';
  try {
    const url = new URL(websocketUrl);
    if (
      url.protocol !== 'wss:' ||
      url.pathname !== '/api-ws/v1/inference' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.hostname.toLowerCase() !==
        `${workspaceId}.cn-beijing.maas.aliyuncs.com`.toLowerCase() ||
      ![asrModel, dictationModel, ttsModel, voice].every((value) =>
        SAFE_ALIAS.test(value),
      )
    ) {
      return { enabled: false, reason: 'invalid_configuration' };
    }
  } catch {
    return { enabled: false, reason: 'invalid_configuration' };
  }
  return {
    enabled: true,
    configuration: {
      apiKey,
      workspaceId,
      websocketUrl,
      asrModel,
      dictationModel,
      ttsModel,
      voice,
    },
  };
}
