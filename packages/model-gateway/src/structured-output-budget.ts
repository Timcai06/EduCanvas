import type { EnabledModelGatewayConfiguration } from './config/config';

/** Provider 支持范围由适配器拥有；未知模型沿用部署已配置的上限。 */
export function structuredOutputBudget(
  config: EnabledModelGatewayConfiguration,
  modelId: string,
  longArtifact: boolean,
): number {
  const configured = config.structuredMaxOutputTokens ?? config.maxOutputTokens;
  // 官方 /models 在 2026-10-01 声明这两个模型支持 393216 output tokens。
  // 仅把已核实的长产物目标提高到 32768，不改变其他任务或兼容代理的预算。
  if (
    longArtifact &&
    config.provider === 'deepseek' &&
    new URL(config.baseUrl).hostname === 'api.deepseek.com' &&
    ['deepseek-v4-pro', 'deepseek-flash'].includes(modelId)
  ) {
    return Math.max(configured, 32_768);
  }
  return configured;
}
