import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  turnApplicationProtocolVersion,
  type TurnApplicationEvent,
} from '@educanvas/agent-core';
import {
  projectTurnApplicationEventToGateway,
  type GatewayEventPayload,
} from '@educanvas/gateway-runtime';
import {
  gatewayToLegacy,
  projectTurnApplicationEventToWeb,
} from './turn-application-projection';
import {
  collect,
  eventsOf,
  makeGatewayEvent,
} from './turn-application-projection-test-helpers';

const base = {
  protocol: turnApplicationProtocolVersion,
  operationId: 'operation:output-limit',
} as const;
const partialText = '已生成并保留的部分正文。';

describe('output_limit public projection', () => {
  it('projects non-retryable budget failure with partial text on both web entry paths', async () => {
    const started: TurnApplicationEvent = {
      ...base,
      type: 'turn.started',
      userMessageId: 'message:user:1',
      assistantMessageId: 'message:assistant:1',
      replayed: false,
    };
    const delta: TurnApplicationEvent = {
      ...base,
      type: 'message.delta',
      messageId: 'message:assistant:1',
      delta: partialText,
    };
    const failed: TurnApplicationEvent = {
      ...base,
      type: 'turn.failed',
      messageId: 'message:assistant:1',
      code: 'BUDGET_EXCEEDED',
      retryable: false,
    };

    const direct = [started, delta, failed].map((event) =>
      projectTurnApplicationEventToWeb(event),
    );
    const gateway = await collect(
      gatewayToLegacy(
        eventsOf(
          [started, delta, failed].map((event, sequence) => {
            const payload: GatewayEventPayload =
              projectTurnApplicationEventToGateway(event, {
                actorUserId: 'user:1',
                occurredAt: '2026-10-01T00:00:00.000Z',
              });
            return makeGatewayEvent(sequence, payload, base.operationId);
          }),
        ),
      ),
    );

    for (const projected of [direct, gateway]) {
      expect(projected[1]).toMatchObject({
        type: 'message.delta',
        delta: partialText,
      });
      expect(projected[2]).toMatchObject({
        type: 'turn.failed',
        code: 'BUDGET_EXCEEDED',
        retryable: false,
        message:
          '本轮内容超过处理上限，请缩小提问、减少附带来源或分章节生成后再发送。',
      });
      expect(
        projected[2]?.type === 'turn.failed' && projected[2].message,
      ).not.toContain('稍后重试');
      expect(
        projected[2]?.type === 'turn.failed' && projected[2].message,
      ).not.toContain(partialText);
    }
  });

  it('uses the same concrete evidence thresholds for research failure copy', () => {
    expect(
      projectTurnApplicationEventToWeb({
        ...base,
        type: 'turn.failed',
        messageId: 'message:assistant:1',
        code: 'RESEARCH_REQUIREMENTS_UNMET',
        retryable: false,
      }),
    ).toMatchObject({
      type: 'turn.failed',
      code: 'RESEARCH_REQUIREMENTS_UNMET',
      retryable: false,
      message:
        '研究材料不足：本轮未达到三轮搜索、五个已读来源和五个有效引用的要求。请补充来源或缩小主题后发起新研究。',
    });
  });
});
