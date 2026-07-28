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

/**
 * GLM 视觉模型真实返回的流形状：未终止的 chunk 直接省略 `finish_reason`，
 * 而不是像 OpenAI/DeepSeek 那样显式发 null。取自 2026-07-28 live smoke 抓包。
 */
const omittedFinishReasonChunks: readonly unknown[] = [
  {
    id: 'glm-fixture-response-id',
    created: 1_785_206_627,
    object: 'chat.completion.chunk',
    model: 'vision-model-explicit',
    choices: [{ index: 0, delta: { role: 'assistant', content: '12' } }],
  },
  {
    id: 'glm-fixture-response-id',
    created: 1_785_206_627,
    object: 'chat.completion.chunk',
    model: 'vision-model-explicit',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        delta: { role: 'assistant', content: '' },
      },
    ],
    usage: {
      prompt_tokens: 105,
      completion_tokens: 2,
      total_tokens: 107,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  },
];

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

  /* 视觉Provider不是DeepSeek，不继承DeepSeek的固定关闭；未声明时不发该字段。 */
  it('未声明关闭思考时视觉请求不携带thinking字段', async () => {
    const captured = await captureRequest(baseEnvironment);

    expect(captured.body).not.toHaveProperty('thinking');
  });

  /*
   * live smoke 实测：GLM-4.6V 默认开启思考，同一个问题 31 个输出 token 里 24 个
   * 是随后被丢弃的 reasoning。EduCanvas 不保留 CoT，因此部署方需要能关掉它。
   */
  it('声明关闭思考后视觉请求携带thinking.disabled', async () => {
    const captured = await captureRequest({
      ...baseEnvironment,
      MODEL_GATEWAY_VISION_DISABLE_THINKING: 'true',
    });

    expect(captured.body).toMatchObject({ thinking: { type: 'disabled' } });
  });

  /* 两个供应商各自声明；主链路关不关思考与视觉模型的默认行为无关。 */
  it('视觉思考开关不继承主Provider的声明', async () => {
    const captured = await captureRequest({
      ...baseEnvironment,
      MODEL_GATEWAY_PROVIDER: 'openai-compatible',
      MODEL_GATEWAY_BASE_URL: 'https://provider.invalid/v1',
      MODEL_GATEWAY_ALLOW_DEEPSEEK: undefined,
      MODEL_GATEWAY_DISABLE_THINKING: 'true',
    });

    expect(captured.body).not.toHaveProperty('thinking');
  });

  /*
   * 回归：省略 finish_reason 的流曾让文本正常流出、终态却是 failed 且 usage 丢失
   * ——学生能看到答案，但该轮被记为失败且没有计量。live smoke 才暴露，Fixture
   * 此前一律显式发 null 所以测不到。
   */
  it('未终止chunk省略finish_reason时仍正常完成并保留usage', async () => {
    const gateway = createVisionTurnModelGatewayFromEnvironment(
      baseEnvironment,
      {
        fetchImpl: (async () =>
          createFixtureResponse(omittedFinishReasonChunks, {
            splitEvery: 9,
          })) as typeof fetch,
        now: () => 100,
      },
    );
    if (gateway === null) throw new Error('vision gateway 未构造');

    const events = [];
    for await (const event of gateway.streamTurnText(answerRequest)) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'usage',
      'completed',
    ]);
    expect(events[0]).toMatchObject({ delta: '12' });
    expect(events[1]).toMatchObject({
      usage: { inputTokens: 105, outputTokens: 2, reasoningTokens: 0 },
    });
    expect(events[2]).toMatchObject({
      metadata: { finishReason: 'stop', usage: { outputTokens: 2 } },
    });
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
