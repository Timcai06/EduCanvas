import type { TurnApplicationCommand } from '@educanvas/agent-core';
import type { PlatformTurnSnapshot } from '@educanvas/db';
import { describe, expect, it, vi } from 'vitest';
import {
  GatewayTurnLifecycle,
  type GatewayTurnRepositoryPort,
} from './lifecycle';

const command: TurnApplicationCommand = {
  protocol: 'educanvas.turn.v2',
  operationId: '00000000-0000-4000-8000-000000000001',
  traceId: 'trace:terminal-intent',
  actor: { actorId: 'user:1', agentId: 'agent:1' },
  notebook: {
    notebookId: 'notebook:1',
    conversationId: 'conversation:1',
  },
  profile: { profileId: 'general' },
  entrypoint: 'web',
  input: {
    clientMessageId: 'message:client:1',
    parts: [{ type: 'text', text: 'test' }],
  },
  capabilities: [],
};

const turn = {
  operationId: command.operationId,
  traceId: command.traceId,
  userMessageId: '00000000-0000-4000-8000-000000000002',
  assistantMessageId: '00000000-0000-4000-8000-000000000003',
  replayed: false,
};

function repository() {
  const settleTurn = vi.fn(async () => ({}) as PlatformTurnSnapshot);
  return {
    settleTurn,
    repository: {
      async attachGatewayTurn() {
        throw new Error('not_used');
      },
      settleTurn,
      async listMessages() {
        return [];
      },
      async isTurnCancellationRequested() {
        return false;
      },
    } satisfies GatewayTurnRepositoryPort,
  };
}

describe('Gateway Turn terminal intent', () => {
  it('把完成消息ID冻结为Gateway terminal intent', async () => {
    const fixture = repository();
    const lifecycle = new GatewayTurnLifecycle(fixture.repository);

    await lifecycle.settle({
      command,
      turn,
      status: 'completed',
      content: 'answer',
      citationMarkers: [1],
    });

    expect(fixture.settleTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        operationTerminalWriter: 'gateway',
        gatewayTerminalIntent: {
          status: 'completed',
          messageId: turn.assistantMessageId,
        },
      }),
    );
  });

  it('只冻结映射后的公开失败码与retryable决定', async () => {
    const fixture = repository();
    const lifecycle = new GatewayTurnLifecycle(fixture.repository);

    await lifecycle.settle({
      command,
      turn,
      status: 'failed',
      content: '',
      failureCode: 'MODEL_FAILED',
      retryable: false,
    });

    expect(fixture.settleTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayTerminalIntent: {
          status: 'failed',
          code: 'RUNTIME_FAILED',
          retryable: false,
        },
      }),
    );
  });

  it('缺少失败重试语义时fail closed', async () => {
    const fixture = repository();
    const lifecycle = new GatewayTurnLifecycle(fixture.repository);

    await expect(
      lifecycle.settle({
        command,
        turn,
        status: 'failed',
        content: '',
        failureCode: 'MODEL_FAILED',
      }),
    ).rejects.toThrow('gateway_failure_intent_missing');
    expect(fixture.settleTurn).not.toHaveBeenCalled();
  });
});
