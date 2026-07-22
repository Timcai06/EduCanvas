import { describe, expect, it } from 'vitest';
import type { TurnModelGateway } from '@educanvas/agent-core';
import {
  TurnApplicationService,
  type TurnApplicationProfilePort,
} from './turn-application';
import {
  ASSISTANT_MESSAGE_ID,
  MemoryContextLedger,
  MemoryLifecycle,
  MemoryModelRunLedger,
  OPERATION_ID,
  USER_MESSAGE_ID,
  collect,
  metadata,
  profile,
} from './turn-application.test-support';

describe('TurnApplicationService (core orchestration)', () => {
  it('唯一编排Context、Model Run、消息终态与transport-neutral事件', async () => {
    const lifecycle = new MemoryLifecycle();
    const contexts = new MemoryContextLedger();
    const models = new MemoryModelRunLedger();
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        yield {
          type: 'text_delta',
          phase: request.phase,
          delta: '你好，我来帮你。',
        };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'stop'),
        };
      },
    };
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: profile(),
        contextLedger: contexts,
        modelRunLedger: models,
        modelGateway: gateway,
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'message.delta',
      'turn.completed',
    ]);
    expect(contexts.writes[0]?.material.includedMessageIds).toEqual([
      USER_MESSAGE_ID,
    ]);
    expect(models.runs).toHaveLength(1);
    expect(models.runs[0]).toMatchObject({
      status: 'succeeded',
      provider: 'fixture',
      providerModelId: 'fixture/model',
    });
    expect(models.createInputs[0]?.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(models.createInputs)).not.toContain('你好');
    expect(lifecycle.settlements[0]).toMatchObject({
      status: 'completed',
      content: '你好，我来帮你。',
    });
  });

  it('由Profile选择稳定taskAlias并贯穿Provider与统一Model Run账本', async () => {
    const models = new MemoryModelRunLedger();
    const teachingProfile: TurnApplicationProfilePort = {
      ...profile(),
      async prepare(input) {
        const plan = await profile().prepare(input);
        return {
          ...plan,
          model: { ...plan.model, taskAlias: 'teaching.turn' as const },
        };
      },
    };
    const requests: string[] = [];
    await collect(
      new TurnApplicationService({
        lifecycle: new MemoryLifecycle(),
        profile: teachingProfile,
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        modelGateway: {
          async *streamTurnText(request) {
            requests.push(request.taskAlias);
            yield {
              type: 'text_delta',
              phase: request.phase,
              delta: '教学回答。',
            };
            yield {
              type: 'completed',
              phase: request.phase,
              metadata: metadata(request, 'stop'),
            };
          },
        },
      }),
    );

    expect(requests).toEqual(['teaching.turn']);
    expect(models.createInputs[0]?.taskAlias).toBe('teaching.turn');
    expect(models.runs[0]?.taskAlias).toBe('teaching.turn');
  });

  it('在结算成功后投影同一Lifecycle事务返回的引用事件', async () => {
    const lifecycle = new MemoryLifecycle(
      false,
      [],
      [
        {
          protocol: 'educanvas.turn.v2',
          operationId: OPERATION_ID,
          type: 'message.citation',
          messageId: ASSISTANT_MESSAGE_ID,
          citationId: 'citation:1',
          marker: 1,
          label: '网页来源',
          target: {
            kind: 'web',
            assetId: 'asset:1',
            assetVersionId: 'asset-version:1',
            url: 'https://example.com/source',
          },
        },
      ],
    );
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: profile(),
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: new MemoryModelRunLedger(),
        modelGateway: {
          async *streamTurnText(request) {
            yield { type: 'text_delta', phase: request.phase, delta: '结论。' };
            yield {
              type: 'completed',
              phase: request.phase,
              metadata: metadata(request, 'stop'),
            };
          },
        },
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'message.delta',
      'message.citation',
      'turn.completed',
    ]);
  });

  it('Provider非法流只会结算失败Model Run，不能误记成功', async () => {
    const lifecycle = new MemoryLifecycle();
    const models = new MemoryModelRunLedger();
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: profile(),
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        modelGateway: {
          async *streamTurnText(request) {
            yield {
              type: 'completed',
              phase: request.phase,
              metadata: metadata(request, 'stop'),
            };
          },
        },
      }),
    );

    expect(events.at(-1)).toMatchObject({
      type: 'turn.failed',
      code: 'MODEL_FAILED',
    });
    expect(models.runs[0]).toMatchObject({
      status: 'failed',
      errorCode: 'model_invalid_response',
    });
  });

  it('replay只投影既有终态，不再次读取Context或调用Provider', async () => {
    const lifecycle = new MemoryLifecycle(true, [
      {
        protocol: 'educanvas.turn.v2',
        operationId: OPERATION_ID,
        type: 'message.delta',
        messageId: ASSISTANT_MESSAGE_ID,
        delta: '既有回答',
      },
      {
        protocol: 'educanvas.turn.v2',
        operationId: OPERATION_ID,
        type: 'turn.completed',
        messageId: ASSISTANT_MESSAGE_ID,
      },
    ]);
    let providerCalls = 0;
    const contexts = new MemoryContextLedger();
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: profile(),
        contextLedger: contexts,
        modelRunLedger: new MemoryModelRunLedger(),
        modelGateway: {
          async *streamTurnText() {
            providerCalls += 1;
          },
        },
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'message.delta',
      'turn.completed',
    ]);
    expect(contexts.writes).toHaveLength(0);
    expect(providerCalls).toBe(0);
  });
});
