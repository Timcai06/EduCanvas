import { AesGcmMcpIntentCipher } from '@educanvas/mcp-runtime';
import { describe, expect, it, vi } from 'vitest';
import { createMcpContinuationAdapter } from './continuation-adapter';

const key = Buffer.alloc(32, 9).toString('base64');
const registration = {
  serverId: 'study-tools',
  endpoint: 'http://127.0.0.1:4321/mcp',
  remoteToolName: 'publish',
  modelToolName: 'publishNotes',
  description: '发布笔记',
  capability: 'external.mcp.invoke' as const,
  risk: 'l2' as const,
  effect: 'write' as const,
  authentication: 'none' as const,
  inputSchema: {
    type: 'object',
    properties: { title: { type: 'string', maxLength: 100 } },
    required: ['title'],
    additionalProperties: false,
  },
  timeoutMs: 2_000,
};
const argumentsValue = { title: '分数笔记' };
const ids = {
  operationId: '10000000-0000-4000-8000-000000000001',
  toolCallId: '20000000-0000-4000-8000-000000000001',
  actorId: 'local:owner',
  agentId: '30000000-0000-4000-8000-000000000001',
  conversationId: '40000000-0000-4000-8000-000000000001',
  resumeRef: `mcp.intent:${'a'.repeat(64)}`,
};

function intent(status: 'prepared' | 'dispatching') {
  const metadata = {
    resumeRef: ids.resumeRef,
    operationId: ids.operationId,
    toolCallId: ids.toolCallId,
    actorId: ids.actorId,
    agentId: ids.agentId,
    serverId: registration.serverId,
    remoteToolName: registration.remoteToolName,
    modelToolName: registration.modelToolName,
    capability: registration.capability,
    risk: registration.risk,
    effect: registration.effect,
    semanticsHash: AesGcmMcpIntentCipher.fromBase64(key).semanticsHash({
      registration,
      arguments: argumentsValue,
    }),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  return {
    ...metadata,
    status,
    sealedPayload:
      status === 'prepared'
        ? AesGcmMcpIntentCipher.fromBase64(key).seal({
            metadata,
            payload: { arguments: argumentsValue, credentialHandle: null },
          })
        : null,
    preparedAt: new Date().toISOString(),
    dispatchStartedAt:
      status === 'dispatching' ? new Date().toISOString() : null,
    settledAt: null,
  };
}

function resumeInput() {
  return {
    continuation: {
      protocol: 'educanvas.operation-continuation.v1',
      continuationId: '50000000-0000-4000-8000-000000000001',
      operationId: ids.operationId,
      sequence: 1,
      status: 'running',
      approvalId: 'approval:mcp',
      work: {
        kind: 'tool_invocation',
        step: 'tool.invoke',
        toolCallId: ids.toolCallId,
        adapterSource: 'mcp',
        resumeRef: ids.resumeRef,
      },
      leaseGeneration: 1,
      leaseOwnerId: 'worker:1',
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      heartbeatAt: new Date().toISOString(),
      failureCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    },
    scope: {
      operationId: ids.operationId,
      actorId: ids.actorId,
      agentId: ids.agentId,
      notebookId: '60000000-0000-4000-8000-000000000001',
      conversationId: ids.conversationId,
      profileId: 'general.default',
      traceId: 'trace:mcp',
      capability: registration.capability,
      risk: 'l2',
    },
    signal: new AbortController().signal,
  } as const;
}

function repositories(
  currentIntent: ReturnType<typeof intent>,
  effectStatus: 'intended' | 'committed' = 'intended',
) {
  const effect = { id: '70000000-0000-4000-8000-000000000001' };
  return {
    intents: {
      getForResume: vi.fn(async () => currentIntent),
      markDispatching: vi.fn(async () => ({
        intent: currentIntent,
        transitioned: true,
      })),
      settle: vi.fn(async () => ({
        intent: currentIntent,
        transitioned: true,
      })),
    },
    calls: {
      markRunning: vi.fn(async () => ({ transitioned: true }) as never),
      settle: vi.fn(async () => ({ transitioned: true }) as never),
    },
    effects: {
      get: vi.fn(async () => ({ ...effect, status: effectStatus }) as never),
      intend: vi.fn(async () => ({ effect, replayed: false }) as never),
      settle: vi.fn(async () => ({ transitioned: true }) as never),
    },
    turns: {
      settleTurn: vi.fn(
        async () =>
          ({ assistantMessage: { id: 'message:assistant' } }) as never,
      ),
    },
  };
}

describe('MCP高风险continuation Adapter', () => {
  it('审批后只外呼一次并结算Tool、Effect、Intent与消息', async () => {
    const repos = repositories(intent('prepared'));
    const client = {
      callTool: vi.fn(async () => ({
        content: [{ type: 'text', text: 'ok' }],
      })),
    };
    const adapter = createMcpContinuationAdapter({
      registrations: [registration],
      encryptionKey: key,
      repositories: repos,
      client,
    });
    await expect(adapter.resume(resumeInput())).resolves.toEqual({
      status: 'completed',
      messageId: 'message:assistant',
    });
    expect(client.callTool).toHaveBeenCalledTimes(1);
    expect(repos.intents.markDispatching).toHaveBeenCalledTimes(1);
    expect(repos.effects.settle).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'committed' }),
    );
  });

  it('重领dispatching意图时禁止重放并收敛outcome_unknown', async () => {
    const repos = repositories(intent('dispatching'));
    const client = { callTool: vi.fn() };
    const adapter = createMcpContinuationAdapter({
      registrations: [registration],
      encryptionKey: key,
      repositories: repos,
      client,
    });
    await expect(adapter.resume(resumeInput())).resolves.toMatchObject({
      status: 'failed',
      continuationFailureCode: 'mcp_dispatch_outcome_unknown',
      retryable: false,
    });
    expect(client.callTool).not.toHaveBeenCalled();
    expect(repos.calls.settle).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'outcome_unknown' }),
    );
  });

  it('外部Effect已提交但进程崩溃时只补齐账本，不再次外呼', async () => {
    const repos = repositories(intent('dispatching'), 'committed');
    const client = { callTool: vi.fn() };
    const adapter = createMcpContinuationAdapter({
      registrations: [registration],
      encryptionKey: key,
      repositories: repos,
      client,
    });
    await expect(adapter.resume(resumeInput())).resolves.toEqual({
      status: 'completed',
      messageId: 'message:assistant',
    });
    expect(client.callTool).not.toHaveBeenCalled();
    expect(repos.calls.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'succeeded',
        result: { status: 'committed', recovered: true },
      }),
    );
  });
});
