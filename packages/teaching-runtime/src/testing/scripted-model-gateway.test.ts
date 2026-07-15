import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  ScriptedModelGateway,
  ScriptedModelGatewayError,
  defaultScriptedModelMetadata,
} from './scripted-model-gateway';

const outputSchema = z
  .object({
    answer: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

function request(taskAlias = 'teaching.turn', promptVersion = 'turn-v1') {
  return {
    taskAlias,
    messages: [
      { role: 'system', content: '保持教学状态约束。' },
      { role: 'user', content: '为什么模型需要训练数据？' },
    ] as const,
    schema: outputSchema,
    promptVersion,
    traceId: 'trace-1',
  };
}

describe('ScriptedModelGateway', () => {
  it('按FIFO返回通过Schema校验的结果并合并默认元数据', async () => {
    const gateway = new ScriptedModelGateway([
      {
        expectedTaskAlias: 'teaching.turn',
        expectedPromptVersion: 'turn-v1',
        output: { answer: '用于提供可学习的样例。', confidence: 0.9 },
      },
      {
        output: { answer: '第二轮回答。', confidence: 0.8 },
        metadata: { modelRevision: 'scripted-v2', latencyMs: 12 },
      },
    ]);

    await expect(gateway.generateStructured(request())).resolves.toEqual({
      output: { answer: '用于提供可学习的样例。', confidence: 0.9 },
      ...defaultScriptedModelMetadata,
    });
    await expect(gateway.generateStructured(request())).resolves.toEqual({
      output: { answer: '第二轮回答。', confidence: 0.8 },
      ...defaultScriptedModelMetadata,
      modelRevision: 'scripted-v2',
      latencyMs: 12,
    });
    expect(gateway.remainingStepCount).toBe(0);
    expect(() => gateway.assertExhausted()).not.toThrow();
  });

  it('捕获不可变请求快照', async () => {
    const gateway = new ScriptedModelGateway([
      { output: { answer: '回答。', confidence: 1 } },
    ]);

    await gateway.generateStructured(request());

    expect(gateway.getCapturedRequests()).toEqual([
      {
        taskAlias: 'teaching.turn',
        messages: [
          { role: 'system', content: '保持教学状态约束。' },
          { role: 'user', content: '为什么模型需要训练数据？' },
        ],
        promptVersion: 'turn-v1',
        traceId: 'trace-1',
      },
    ]);
    expect(Object.isFrozen(gateway.getCapturedRequests()[0])).toBe(true);
    expect(Object.isFrozen(gateway.getCapturedRequests()[0]?.messages)).toBe(
      true,
    );
  });

  it.each([
    {
      step: { expectedTaskAlias: 'another.task', output: {} },
      code: 'TASK_ALIAS_MISMATCH',
    },
    {
      step: { expectedPromptVersion: 'turn-v2', output: {} },
      code: 'PROMPT_VERSION_MISMATCH',
    },
  ] as const)(
    '以稳定错误码拒绝调用契约不一致：$code',
    async ({ step, code }) => {
      const gateway = new ScriptedModelGateway([step]);

      await expect(gateway.generateStructured(request())).rejects.toMatchObject(
        {
          name: 'ScriptedModelGatewayError',
          code,
        },
      );
    },
  );

  it('以稳定错误码拒绝未通过strict Schema的输出', async () => {
    const gateway = new ScriptedModelGateway([
      {
        output: {
          answer: '回答。',
          confidence: 0.7,
          untrustedField: true,
        },
      },
    ]);

    await expect(gateway.generateStructured(request())).rejects.toMatchObject({
      name: 'ScriptedModelGatewayError',
      code: 'OUTPUT_SCHEMA_MISMATCH',
      cause: expect.any(z.ZodError),
    });
  });

  it('原样抛出脚本指定的模型调用错误', async () => {
    const providerError = new Error('provider unavailable');
    const gateway = new ScriptedModelGateway([{ error: providerError }]);

    await expect(gateway.generateStructured(request())).rejects.toBe(
      providerError,
    );
  });

  it('检测非法步骤、脚本耗尽和未消费步骤', async () => {
    expect(
      () =>
        new ScriptedModelGateway([
          { output: { answer: '回答。', confidence: 1 }, error: new Error() },
        ]),
    ).toThrowError(
      expect.objectContaining<Partial<ScriptedModelGatewayError>>({
        code: 'INVALID_STEP',
      }),
    );
    expect(() => new ScriptedModelGateway([{}])).toThrowError(
      expect.objectContaining<Partial<ScriptedModelGatewayError>>({
        code: 'INVALID_STEP',
      }),
    );
    expect(
      () =>
        new ScriptedModelGateway([
          {
            output: { answer: '回答。', confidence: 1 },
            metadata: { latencyMs: -1 },
          },
        ]),
    ).toThrowError(
      expect.objectContaining<Partial<ScriptedModelGatewayError>>({
        code: 'INVALID_STEP',
      }),
    );

    const emptyGateway = new ScriptedModelGateway([]);
    await expect(
      emptyGateway.generateStructured(request()),
    ).rejects.toMatchObject({ code: 'SCRIPT_EXHAUSTED' });

    const pendingGateway = new ScriptedModelGateway([
      { output: { answer: '回答。', confidence: 1 } },
    ]);
    expect(() => pendingGateway.assertExhausted()).toThrowError(
      expect.objectContaining<Partial<ScriptedModelGatewayError>>({
        code: 'UNCONSUMED_STEPS',
      }),
    );
  });
});
