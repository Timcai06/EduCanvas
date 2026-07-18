import type { StructuredModelGateway } from '@educanvas/agent-core';
import { describe, expect, it } from 'vitest';
import {
  AUDIO_OVERVIEW_MODEL_GENERATOR,
  AUDIO_OVERVIEW_RULE_GENERATOR,
  buildRuleAudioOverviewScript,
  generateAudioOverviewScript,
} from './audio-overview-generation';

const sources = [
  { displayName: '资料甲', content: '神经网络由多层神经元组成。' },
  { displayName: '资料乙', content: '训练过程通过误差更新权重。' },
];

describe('音频概览脚本', () => {
  it('规则版只压缩来源并明确来源数量', () => {
    const script = buildRuleAudioOverviewScript('神经网络', sources);
    expect(script).toContain('基于你勾选的2项来源');
    expect(script).toContain('资料甲');
    expect(script).toContain('回到原始资料核对');
    expect(script.length).toBeLessThanOrEqual(3_500);
  });

  it('未配置结构化模型时保留规则生成溯源', async () => {
    const result = await generateAudioOverviewScript({
      title: '神经网络',
      sources,
      gateway: null,
      traceId: 'trace',
      operationId: 'job',
    });
    expect(result.audit).toMatchObject({
      generator: AUDIO_OVERVIEW_RULE_GENERATOR,
      provider: null,
    });
  });

  it('模型脚本保留模型、token 与延迟审计', async () => {
    const gateway: StructuredModelGateway = {
      async generateStructured(request) {
        return {
          output: request.schema.parse({ script: '模型生成的来源概览。' }),
          metadata: {
            providerResponseId: 'r1',
            provider: 'fixture',
            taskAlias: request.taskAlias,
            modelAlias: request.modelAlias,
            resolvedModelId: 'structured-v1',
            modelRevision: null,
            systemFingerprint: null,
            finishReason: 'stop',
            usage: {
              inputTokens: 20,
              outputTokens: 8,
              cacheHitTokens: 0,
              reasoningTokens: 0,
            },
            latencyMs: 12,
            traceId: request.traceId,
          },
        };
      },
    };
    const result = await generateAudioOverviewScript({
      title: '神经网络',
      sources,
      gateway,
      traceId: 'trace',
      operationId: 'job',
    });
    expect(result.audit).toMatchObject({
      generator: AUDIO_OVERVIEW_MODEL_GENERATOR,
      provider: 'fixture',
      resolvedModelId: 'structured-v1',
      inputTokens: 20,
      outputTokens: 8,
      latencyMs: 12,
    });
  });
});
