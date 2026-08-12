import 'server-only';

import type { SpeechModelGateway } from '@educanvas/agent-core';
import {
  DashScopeSpeechModelGateway,
  OpenAICompatibleSpeechModelGateway,
  parseDashScopeSpeechConfiguration,
  parseModelGatewayConfiguration,
  resolveCapabilityGatewayConfiguration,
} from '@educanvas/model-gateway';

/**
 * 非流式语音回答只复用显式配置的 speech 能力。配置错误按不可用收敛，
 * Provider Secret 只进入 model-gateway adapter，不跨过服务端边界。
 */
export function resolveSpeechGateway(
  environment: NodeJS.ProcessEnv = process.env,
): SpeechModelGateway | null {
  try {
    const primary = parseModelGatewayConfiguration(environment);
    if (primary.enabled) {
      const speech = resolveCapabilityGatewayConfiguration(
        environment,
        'speech',
        primary,
      );
      if (speech) return new OpenAICompatibleSpeechModelGateway(speech);
    }
    if (environment.MODEL_GATEWAY_SPEECH_PROVIDER?.trim()) return null;
    const dashscope = parseDashScopeSpeechConfiguration(environment);
    return dashscope.enabled
      ? new DashScopeSpeechModelGateway(dashscope.configuration)
      : null;
  } catch {
    return null;
  }
}
