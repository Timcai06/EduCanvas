import type {
  StreamTurnTextRequest,
  StructuredModelRequest,
  TurnModelEvent,
} from '@educanvas/teaching-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ScriptedModelGateway,
  ScriptedModelGatewayError,
} from './scripted-model-gateway';

const outputSchema = z
  .object({
    title: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

function structuredRequest(
  promptVersion = 'artifact-v1',
): StructuredModelRequest<z.infer<typeof outputSchema>> {
  return {
    taskAlias: 'artifact.generate',
    modelAlias: 'structured',
    messages: [
      { role: 'system', content: '只生成受控Artifact JSON。' },
      { role: 'user', content: '生成猫狗分类互动。' },
    ],
    schema: outputSchema,
    promptVersion,
    traceId: 'trace-1',
    operationId: 'proposal-1',
  };
}

function streamRequest(
  phase: StreamTurnTextRequest['phase'] = 'answer',
): StreamTurnTextRequest {
  return {
    taskAlias: 'teaching.turn',
    modelAlias: 'primary',
    phase,
    messages: [
      { role: 'system', content: '保持教学状态约束。' },
      { role: 'user', content: '为什么模型需要训练数据？' },
    ],
    tools: [],
    toolResults: [],
    promptVersion: phase === 'answer' ? 'turn-answer-v1' : 'turn-synthesis-v1',
    traceId: 'trace-1',
    turnId: 'turn-1',
  };
}

async function collectStream(
  gateway: ScriptedModelGateway,
  request: StreamTurnTextRequest,
) {
  const events: TurnModelEvent[] = [];
  for await (const event of gateway.streamTurnText(request)) events.push(event);
  return events;
}

describe('ScriptedModelGateway', () => {
  it('保持结构化Fixture兼容，但teaching.turn不进入该入口', async () => {
    const gateway = new ScriptedModelGateway([
      {
        expectedTaskAlias: 'artifact.generate',
        expectedModelAlias: 'structured',
        expectedPromptVersion: 'artifact-v1',
        output: { title: '猫狗分类', confidence: 0.9 },
      },
    ]);

    await expect(
      gateway.generateStructured(structuredRequest()),
    ).resolves.toMatchObject({
      output: { title: '猫狗分类', confidence: 0.9 },
      metadata: {
        provider: 'scripted',
        taskAlias: 'artifact.generate',
        modelAlias: 'structured',
        traceId: 'trace-1',
      },
    });
    expect(gateway.getCapturedRequests()).toEqual([
      {
        kind: 'structured',
        taskAlias: 'artifact.generate',
        modelAlias: 'structured',
        messages: [
          { role: 'system', content: '只生成受控Artifact JSON。' },
          { role: 'user', content: '生成猫狗分类互动。' },
        ],
        promptVersion: 'artifact-v1',
        traceId: 'trace-1',
        operationId: 'proposal-1',
      },
    ]);
    expect(Object.isFrozen(gateway.getCapturedRequests()[0])).toBe(true);
    gateway.assertExhausted();
  });

  it('按FIFO提供流式事件并捕获阶段、工具与toolResults', async () => {
    const events = [
      { type: 'text_delta', phase: 'answer', delta: '训练数据提供样例。' },
      {
        type: 'completed',
        phase: 'answer',
        metadata: {
          providerResponseId: 'response-1',
          provider: 'scripted',
          taskAlias: 'teaching.turn',
          modelAlias: 'primary',
          resolvedModelId: 'scripted/model',
          modelRevision: 'v1',
          systemFingerprint: null,
          finishReason: 'stop',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheHitTokens: 0,
            reasoningTokens: 0,
          },
          latencyMs: 1,
          traceId: 'trace-1',
        },
      },
    ] as const;
    const gateway = new ScriptedModelGateway([
      {
        kind: 'stream',
        expectedTaskAlias: 'teaching.turn',
        expectedModelAlias: 'primary',
        expectedPhase: 'answer',
        expectedPromptVersion: 'turn-answer-v1',
        events,
      },
    ]);

    await expect(collectStream(gateway, streamRequest())).resolves.toEqual(
      events,
    );
    expect(gateway.getCapturedStreamRequests()).toEqual([
      expect.objectContaining({
        kind: 'stream',
        taskAlias: 'teaching.turn',
        modelAlias: 'primary',
        phase: 'answer',
        tools: [],
        toolResults: [],
        traceId: 'trace-1',
        turnId: 'turn-1',
      }),
    ]);
  });

  it.each([
    {
      step: { expectedTaskAlias: 'retrieval.query_rewrite', output: {} },
      code: 'TASK_ALIAS_MISMATCH',
    },
    {
      step: { expectedModelAlias: 'fast', output: {} },
      code: 'MODEL_ALIAS_MISMATCH',
    },
    {
      step: { expectedPromptVersion: 'artifact-v2', output: {} },
      code: 'PROMPT_VERSION_MISMATCH',
    },
  ] as const)(
    '以稳定错误码拒绝结构化调用契约不一致：$code',
    async ({ step, code }) => {
      const gateway = new ScriptedModelGateway([step]);
      await expect(
        gateway.generateStructured(structuredRequest()),
      ).rejects.toMatchObject({ name: 'ScriptedModelGatewayError', code });
    },
  );

  it('拒绝未通过strict Schema的结构化输出', async () => {
    const gateway = new ScriptedModelGateway([
      {
        output: {
          title: '猫狗分类',
          confidence: 0.7,
          untrustedField: true,
        },
      },
    ]);

    await expect(
      gateway.generateStructured(structuredRequest()),
    ).rejects.toMatchObject({
      name: 'ScriptedModelGatewayError',
      code: 'OUTPUT_SCHEMA_MISMATCH',
      cause: expect.any(z.ZodError),
    });
  });

  it('区分流式与结构化步骤并检测脚本耗尽和非法步骤', async () => {
    expect(
      () =>
        new ScriptedModelGateway([
          {
            kind: 'stream',
            events: [],
            error: new Error('invalid'),
          },
        ]),
    ).toThrowError(
      expect.objectContaining<Partial<ScriptedModelGatewayError>>({
        code: 'INVALID_STEP',
      }),
    );

    const kindMismatch = new ScriptedModelGateway([
      { kind: 'stream', events: [] },
    ]);
    await expect(
      kindMismatch.generateStructured(structuredRequest()),
    ).rejects.toMatchObject({ code: 'STEP_KIND_MISMATCH' });

    const emptyGateway = new ScriptedModelGateway([]);
    await expect(
      emptyGateway.generateStructured(structuredRequest()),
    ).rejects.toMatchObject({ code: 'SCRIPT_EXHAUSTED' });

    const pendingGateway = new ScriptedModelGateway([
      { output: { title: '未消费', confidence: 1 } },
    ]);
    expect(() => pendingGateway.assertExhausted()).toThrowError(
      expect.objectContaining<Partial<ScriptedModelGatewayError>>({
        code: 'UNCONSUMED_STEPS',
      }),
    );
  });
});
