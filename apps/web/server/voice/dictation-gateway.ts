import 'server-only';

import type { AudioTranscriptionModelGateway } from '@educanvas/agent-core';
import {
  DashScopeAudioTranscriptionModelGateway,
  OpenAICompatibleAudioTranscriptionModelGateway,
  parseDashScopeSpeechConfiguration,
  parseModelGatewayConfiguration,
  resolveCapabilityGatewayConfiguration,
} from '@educanvas/model-gateway';

/**
 * Dictation 只复用已配置的一次性 transcription 能力。配置解析失败与未配置
 * 都按不可用处理；Provider key 只进入 model-gateway adapter。
 */
export function resolveDictationGateway(
  environment: NodeJS.ProcessEnv = process.env,
): AudioTranscriptionModelGateway | null {
  try {
    const primary = parseModelGatewayConfiguration(environment);
    if (primary.enabled) {
      const transcription = resolveCapabilityGatewayConfiguration(
        environment,
        'transcription',
        primary,
      );
      if (transcription)
        return new OpenAICompatibleAudioTranscriptionModelGateway(
          transcription,
        );
    }
    if (environment.MODEL_GATEWAY_TRANSCRIPTION_PROVIDER?.trim()) return null;
    const dashscope = parseDashScopeSpeechConfiguration(environment);
    return dashscope.enabled
      ? new DashScopeAudioTranscriptionModelGateway(dashscope.configuration)
      : null;
  } catch {
    return null;
  }
}
