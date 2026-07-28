import { describe, expect, it } from 'vitest';
import type { ModelGatewayEnvironment } from './config';
import {
  createTurnModelGatewayFromEnvironment,
  createVisionTurnModelGatewayFromEnvironment,
} from './turn-model-gateway-factory';
import { answerRequest } from './openai-compatible-turn-model-gateway.test-support';
import {
  createFixtureResponse,
  textStreamChunks,
} from './testing/openai-compatible-fixtures';

const baseEnvironment: ModelGatewayEnvironment = {
  EDUCANVAS_DEPLOYMENT_ENV: 'local',
  MODEL_GATEWAY_PROVIDER: 'deepseek',
  MODEL_GATEWAY_ALLOW_DEEPSEEK: 'true',
  MODEL_GATEWAY_BASE_URL: 'https://api.deepseek.com',
  MODEL_GATEWAY_API_KEY: 'fixture-primary-key-never-real',
  MODEL_GATEWAY_PRIMARY_MODEL: 'primary-model-explicit',
  MODEL_GATEWAY_VISION_MODEL: 'vision-model-explicit',
  MODEL_GATEWAY_VISION_BASE_URL: 'https://vision.invalid/api/paas/v4',
  MODEL_GATEWAY_VISION_API_KEY: 'fixture-vision-key-never-real',
};

/** 捕获一次请求的目标URL、鉴权头与请求体，用于断言凭据与模型没有串线。 */
async function captureRequest(
  environment: ModelGatewayEnvironment,
  modelAlias: 'primary' | 'fast' | 'structured' = 'primary',
): Promise<{
  url: string;
  authorization: string;
  body: Record<string, unknown>;
}> {
  let input: URL | RequestInfo | undefined;
  let init: RequestInit | undefined;
  const gateway = createVisionTurnModelGatewayFromEnvironment(environment, {
    fetchImpl: (async (
      capturedInput: URL | RequestInfo,
      capturedInit?: RequestInit,
    ) => {
      input = capturedInput;
      init = capturedInit;
      return createFixtureResponse(textStreamChunks, { splitEvery: 7 });
    }) as typeof fetch,
    now: () => 100,
  });
  if (gateway === null) throw new Error('vision gateway 未构造');
  for await (const _event of gateway.streamTurnText({
    ...answerRequest,
    modelAlias,
  }));
  const headers = new Headers(init?.headers);
  return {
    url: String(input),
    authorization: headers.get('authorization') ?? '',
    body: JSON.parse(String(init?.body)) as Record<string, unknown>,
  };
}

describe('视觉Turn Gateway构造', () => {
  it('未配置视觉Provider时不构造视觉Gateway', () => {
    expect(
      createVisionTurnModelGatewayFromEnvironment({
        ...baseEnvironment,
        MODEL_GATEWAY_VISION_MODEL: undefined,
        MODEL_GATEWAY_VISION_BASE_URL: undefined,
        MODEL_GATEWAY_VISION_API_KEY: undefined,
      }),
    ).toBeNull();
  });

  it('主Provider禁用时视觉Gateway也不构造', () => {
    expect(
      createVisionTurnModelGatewayFromEnvironment({
        ...baseEnvironment,
        MODEL_GATEWAY_ALLOW_DEEPSEEK: undefined,
      }),
    ).toBeNull();
  });

  it('配置齐备时主Gateway与视觉Gateway是两个独立实例', () => {
    const primary = createTurnModelGatewayFromEnvironment(baseEnvironment);
    const vision = createVisionTurnModelGatewayFromEnvironment(baseEnvironment);

    expect(primary).not.toBeNull();
    expect(vision).not.toBeNull();
    expect(vision).not.toBe(primary);
  });

  /* Adapter持有Base URL与Key；两套凭据串线会让审计无法判定这次请求用了哪个供应商。 */
  it('视觉请求发往视觉端点并使用视觉Key', async () => {
    const captured = await captureRequest(baseEnvironment);

    expect(captured.url).toBe(
      'https://vision.invalid/api/paas/v4/chat/completions',
    );
    expect(captured.authorization).toBe('Bearer fixture-vision-key-never-real');
    expect(captured.authorization).not.toContain('primary');
  });

  /* synthesis阶段按fast取模型；alias缺失会让整轮在第二次调用时静默失败。 */
  it.each(['primary', 'fast', 'structured'] as const)(
    '%s别名都解析到同一个视觉模型',
    async (modelAlias) => {
      const captured = await captureRequest(baseEnvironment, modelAlias);

      expect(captured.body).toMatchObject({ model: 'vision-model-explicit' });
    },
  );

  /* 视觉Provider不是DeepSeek，不能继承DeepSeek专属的固定关闭thinking。 */
  it('视觉请求不携带DeepSeek专属的thinking字段', async () => {
    const captured = await captureRequest(baseEnvironment);

    expect(captured.body).not.toHaveProperty('thinking');
  });

  it('视觉Provider的超时与输出上限独立于主Provider', async () => {
    const captured = await captureRequest({
      ...baseEnvironment,
      MODEL_GATEWAY_MAX_OUTPUT_TOKENS: '512',
      MODEL_GATEWAY_VISION_MAX_OUTPUT_TOKENS: '4096',
    });

    expect(captured.body).toMatchObject({ max_tokens: 4_096 });
  });
});
