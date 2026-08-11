import 'server-only';

import type { AudioTranscriptionModelGateway } from '@educanvas/agent-core';
import {
  OpenAICompatibleAudioTranscriptionModelGateway,
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
    if (!primary.enabled) return null;
    const transcription = resolveCapabilityGatewayConfiguration(
      environment,
      'transcription',
      primary,
    );
    return transcription
      ? new OpenAICompatibleAudioTranscriptionModelGateway(transcription)
      : null;
  } catch {
    return null;
  }
}
