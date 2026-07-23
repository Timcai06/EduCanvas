import { describe, expect, it } from 'vitest';
import { AiSdkTurnModelGateway } from './ai-sdk-turn-model-gateway';
import { OpenAICompatibleTurnModelGateway } from './openai-compatible-turn-model-gateway';
import { createTurnModelGatewayFromEnvironment } from './turn-model-gateway-factory';

const environment = (runtime: 'native' | 'ai-sdk') => ({
  EDUCANVAS_DEPLOYMENT_ENV: 'local',
  MODEL_GATEWAY_PROVIDER: 'deepseek',
  MODEL_GATEWAY_ALLOW_DEEPSEEK: 'true',
  MODEL_GATEWAY_RUNTIME: runtime,
  MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com',
  MODEL_GATEWAY_API_KEY: 'fixture-key-never-real',
  MODEL_GATEWAY_PRIMARY_MODEL: 'explicitly-configured-model',
});

describe('createTurnModelGatewayFromEnvironment', () => {
  it('默认与显式native都构造原生回滚Adapter', () => {
    const values = environment('native');
    expect(
      createTurnModelGatewayFromEnvironment({
        ...values,
        MODEL_GATEWAY_RUNTIME: undefined,
      }),
    ).toBeInstanceOf(OpenAICompatibleTurnModelGateway);
    expect(createTurnModelGatewayFromEnvironment(values)).toBeInstanceOf(
      OpenAICompatibleTurnModelGateway,
    );
  });

  it('仅在显式ai-sdk时构造SDK Adapter且不发起网络', () => {
    expect(
      createTurnModelGatewayFromEnvironment(environment('ai-sdk')),
    ).toBeInstanceOf(AiSdkTurnModelGateway);
  });
});
