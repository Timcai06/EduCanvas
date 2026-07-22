import { describe, expect, it, vi } from 'vitest';
import { prepareMcpApproval } from './approval-preparation';
import { AesGcmMcpIntentCipher } from './intent-codec';
import { mcpRegistration } from './test-support';

describe('MCP高风险审批准备', () => {
  it('只把密文交给Adapter仓储并把稳定引用交给公共Intent', async () => {
    const traceCarrier = {
      traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    } as const;
    const durablePrepare = vi.fn(async (input: { metadata: object }) => ({
      intent: { ...input.metadata, status: 'prepared' },
      replayed: false,
    }));
    const approvalPrepare = vi.fn(async () => ({ replayed: false }) as never);
    const result = await prepareMcpApproval({
      registration: mcpRegistration({
        remoteToolName: 'publish',
        modelToolName: 'publishNotes',
        capability: 'external.mcp.invoke',
        risk: 'l2',
        effect: 'write',
      }) as ReturnType<typeof mcpRegistration> & {
        capability: 'external.mcp.invoke';
        risk: 'l2';
        effect: 'write';
      },
      arguments: { privateTitle: '分数错题本' },
      context: {
        operationId: '10000000-0000-4000-8000-000000000001',
        toolCallId: '20000000-0000-4000-8000-000000000001',
        executionId: 'execution:mcp',
        conversationId: '30000000-0000-4000-8000-000000000001',
        traceId: 'trace:mcp',
        actorId: 'local:owner',
        agentId: '40000000-0000-4000-8000-000000000001',
        notebookId: '50000000-0000-4000-8000-000000000001',
        profileId: 'general.default',
        channel: 'web',
        environment: 'test',
        credentialHandle: 'credential:opaque',
        profileContext: {},
        traceCarrier,
        signal: new AbortController().signal,
      },
      dependencies: {
        durableIntents: { prepare: durablePrepare } as never,
        approvalIntents: { prepare: approvalPrepare },
        cipher: new AesGcmMcpIntentCipher(Buffer.alloc(32, 4)),
        now: () => new Date('2026-07-22T12:00:00.000Z'),
      },
    });
    expect(result).toMatchObject({
      approvalId: expect.stringMatching(/^mcp\.approval:[a-f0-9]{64}$/),
      expiresAt: '2026-07-22T12:15:00.000Z',
    });
    expect(JSON.stringify(durablePrepare.mock.calls)).not.toContain(
      '分数错题本',
    );
    expect(JSON.stringify(durablePrepare.mock.calls)).not.toContain(
      'credential:opaque',
    );
    expect(approvalPrepare).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: result.approvalId,
        work: expect.objectContaining({
          adapterSource: 'mcp',
          resumeRef: expect.stringMatching(/^mcp\.intent:[a-f0-9]{64}$/),
        }),
        traceCarrier,
      }),
    );
  });
});
