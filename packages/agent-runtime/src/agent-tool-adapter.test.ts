import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { adaptAgentTool } from './agent-tool-adapter';

describe('Local AgentTool兼容Adapter', () => {
  it('保留Schema并只从Kernel可信上下文注入身份与取消信号', async () => {
    const handler = vi.fn(async (input: { query: string }, context) => ({
      value: `${context.subjectId}:${input.query}`,
    }));
    const adapted = adaptAgentTool(
      {
        name: 'webSearch',
        description: '搜索网页',
        inputSchema: z.object({ query: z.string() }).strict(),
        outputSchema: z.object({ value: z.string() }).strict(),
        timeoutMs: 1_000,
        handler,
      },
      { capability: 'web.search', risk: 'l1', effect: 'read' },
    );
    const controller = new AbortController();
    await expect(
      adapted.invoke(
        { query: '数学' },
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
          signal: controller.signal,
        },
      ),
    ).resolves.toEqual({ value: 'user-1:数学' });
    expect(handler).toHaveBeenCalledWith(
      { query: '数学' },
      expect.objectContaining({
        traceId: 'trace-1',
        turnId: 'operation-1',
        subjectId: 'user-1',
        conversationId: 'conversation-1',
        signal: controller.signal,
      }),
    );
    expect(adapted).toMatchObject({
      source: 'local',
      capability: 'web.search',
      risk: 'l1',
      effect: 'read',
    });
  });
});
