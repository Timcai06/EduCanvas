export interface DashScopeSpeechConfiguration {
  readonly apiKey: string;
  readonly workspaceId: string;
  readonly websocketUrl: string;
  readonly asrModel: string;
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
  const ttsModel = env.DASHSCOPE_TTS_MODEL?.trim() || 'cosyvoice-v3-flash';
  const voice = env.DASHSCOPE_TTS_VOICE?.trim() || 'longanyang';
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
      ![asrModel, ttsModel, voice].every((value) => SAFE_ALIAS.test(value))
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
      ttsModel,
      voice,
    },
  };
}
