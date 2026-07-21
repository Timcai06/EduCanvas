import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { defineTeachingTool } from './tool-executor';
import { adaptTeachingTool } from './tool-kernel-adapter';

describe('Teaching Tool兼容Adapter', () => {
  it('验证Profile上下文并保留教学handler信任字段', async () => {
    const handler = vi.fn(async (_input: { node: string }, context) => ({
      state: context.state,
    }));
    const adapted = adaptTeachingTool(
      defineTeachingTool({
        name: 'retrieveKnowledge',
        description: '检索知识',
        exposure: 'model',
        effect: 'read',
        timeoutMs: 1_000,
        inputSchema: z.object({ node: z.string() }).strict(),
        outputSchema: z.object({ state: z.literal('EXPLAIN') }).strict(),
        handler,
      }),
      { capability: 'teaching.retrieve_knowledge', risk: 'l1' },
    );
    const controller = new AbortController();
    const context = {
      operationId: '30000000-0000-4000-8000-000000000001',
      executionId: 'execution-1',
      conversationId: '30000000-0000-4000-8000-000000000002',
      traceId: 'trace-1',
      actorId: 'user-1',
      agentId: '30000000-0000-4000-8000-000000000003',
      notebookId: '30000000-0000-4000-8000-000000000004',
      profileId: 'education.default',
      channel: 'web',
      environment: 'test',
      credentialHandle: null,
      profileContext: {
        studentId: 'student-1',
        sessionId: '30000000-0000-4000-8000-000000000005',
        knowledgeNodeId: 'fractions',
        state: 'EXPLAIN',
      },
      signal: controller.signal,
    } as const;
    await expect(
      adapted.invoke({ node: 'fractions' }, context),
    ).resolves.toEqual({ state: 'EXPLAIN' });
    expect(handler).toHaveBeenCalledWith(
      { node: 'fractions' },
      expect.objectContaining({
        executionId: 'execution-1',
        studentId: 'student-1',
        sessionId: context.profileContext.sessionId,
        state: 'EXPLAIN',
        signal: controller.signal,
      }),
    );
    expect(adapted).toMatchObject({
      source: 'teaching',
      capability: 'teaching.retrieve_knowledge',
    });
  });

  it('缺失教学Profile上下文时诚实失败而不调用handler', async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const adapted = adaptTeachingTool(
      defineTeachingTool({
        name: 'getStudentState',
        description: '读取状态',
        exposure: 'model',
        effect: 'read',
        timeoutMs: 1_000,
        inputSchema: z.object({}).strict(),
        outputSchema: z.object({ ok: z.boolean() }).strict(),
        handler,
      }),
      { capability: 'teaching.get_student_state', risk: 'l0' },
    );
    await expect(
      adapted.invoke(
        {},
        {
          operationId: 'operation-1',
          executionId: 'execution-1',
          conversationId: 'conversation-1',
          traceId: 'trace-1',
          actorId: 'user-1',
          agentId: 'agent-1',
          notebookId: 'notebook-1',
          profileId: 'education.default',
          channel: 'web',
          environment: 'test',
          credentialHandle: null,
          profileContext: {},
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toBeDefined();
    expect(handler).not.toHaveBeenCalled();
  });
});
