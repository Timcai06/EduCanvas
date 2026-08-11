import 'server-only';

import type { SpeechModelGateway } from '@educanvas/agent-core';
import {
  OpenAICompatibleSpeechModelGateway,
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
    if (!primary.enabled) return null;
    const speech = resolveCapabilityGatewayConfiguration(
      environment,
      'speech',
      primary,
    );
    return speech ? new OpenAICompatibleSpeechModelGateway(speech) : null;
  } catch {
    return null;
  }
}
