import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { gatewayToLegacy } from './turn-application-projection';
import {
  collect,
  eventsOf,
  makeGatewayEvent,
} from './turn-application-projection-test-helpers';

describe('gatewayToLegacy 流序语义', () => {
  it('message.delta 在 message.started 之前到达会被丢弃，不虚构 messageId', async () => {
    const events = await collect(
      gatewayToLegacy(
        eventsOf([
          makeGatewayEvent(0, {
            type: 'message.delta',
            delta: '提前到达的增量',
          }),
        ]),
      ),
    );
    expect(events).toEqual([]);
  });

  it('完整流保持 started→delta→completed 顺序与 messageId 关联', async () => {
    const events = await collect(
      gatewayToLegacy(
        eventsOf([
          makeGatewayEvent(0, {
            type: 'message.started',
            userMessageId: 'message:user:1',
            assistantMessageId: 'message:assistant:1',
            replayed: false,
          }),
          makeGatewayEvent(1, { type: 'message.delta', delta: '你好' }),
          makeGatewayEvent(2, {
            type: 'operation.completed',
            messageId: 'message:assistant:1',
          }),
        ]),
      ),
    );
    expect(events).toEqual([
      {
        schemaVersion: '1',
        turnId: 'operation:1',
        type: 'turn.accepted',
        studentMessageId: 'message:user:1',
        assistantMessageId: 'message:assistant:1',
        replayed: false,
      },
      {
        schemaVersion: '1',
        turnId: 'operation:1',
        type: 'message.delta',
        messageId: 'message:assistant:1',
        delta: '你好',
      },
      {
        schemaVersion: '1',
        turnId: 'operation:1',
        type: 'turn.completed',
        messageId: 'message:assistant:1',
      },
    ]);
  });

  it('operation.failed 在 started 之后用 assistantMessageId 作 messageId', async () => {
    const events = await collect(
      gatewayToLegacy(
        eventsOf([
          makeGatewayEvent(0, {
            type: 'message.started',
            userMessageId: 'message:user:1',
            assistantMessageId: 'message:assistant:1',
            replayed: false,
          }),
          makeGatewayEvent(1, {
            type: 'operation.failed',
            code: 'CANCELLED',
            retryable: false,
          }),
        ]),
      ),
    );
    expect(events[1]).toEqual({
      schemaVersion: '1',
      turnId: 'operation:1',
      type: 'turn.failed',
      messageId: 'message:assistant:1',
      code: 'CANCELLED',
      message: 'AI 暂时无法回答，请稍后重试。',
      retryable: false,
    });
  });
});
