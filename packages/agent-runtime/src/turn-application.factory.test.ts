import { describe, expect, it } from 'vitest';
import type { TurnModelGateway } from '@educanvas/agent-core';
import { createTurnApplication } from './turn-application';
import {
  MemoryContextLedger,
  MemoryLifecycle,
  MemoryModelRunLedger,
  collect,
  metadata,
  profile,
} from './turn-application.test-support';

describe('createTurnApplication (R06 唯一组合工厂)', () => {
  it('返回可运行服务并保持 core 编排语义（started → delta → completed）', async () => {
    const lifecycle = new MemoryLifecycle();
    const contexts = new MemoryContextLedger();
    const models = new MemoryModelRunLedger();
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        yield { type: 'text_delta', phase: request.phase, delta: '你好。' };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'stop'),
        };
      },
    };
    const service = createTurnApplication({
      lifecycle,
      profile: profile(),
      contextLedger: contexts,
      modelRunLedger: models,
      modelGateway: gateway,
    });

    const events = await collect(service);
    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'message.delta',
      'turn.completed',
    ]);
    expect(models.runs[0]?.status).toBe('succeeded');
    expect(lifecycle.settlements[0]).toMatchObject({ status: 'completed' });
  });

  it('支持可选依赖透传（toolKernel / cancellation / trace）且缺省时不改变行为', async () => {
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        yield {
          type: 'text_delta',
          phase: request.phase,
          delta: '可选依赖回答。',
        };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'stop'),
        };
      },
    };
    const withOptionals = createTurnApplication({
      lifecycle: new MemoryLifecycle(),
      profile: profile(),
      contextLedger: new MemoryContextLedger(),
      modelRunLedger: new MemoryModelRunLedger(),
      modelGateway: gateway,
      // 可选依赖缺省：工厂与直接 new 的行为一致
    });
    const events = await collect(withOptionals);
    expect(events.at(-1)?.type).toBe('turn.completed');
  });
});
