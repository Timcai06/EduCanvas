import { describe, expect, it, vi } from 'vitest';
import type { TurnModelGateway } from '@educanvas/agent-core';
import { z } from 'zod';
import {
  TurnApplicationService,
  type TurnApplicationProfilePort,
} from './turn-application';
import { ToolKernel, type ToolKernelAdapter } from './tool-kernel';
import {
  MemoryCallLedger,
  MemoryContextLedger,
  MemoryEffectLedger,
  MemoryLifecycle,
  MemoryModelRunLedger,
  collect,
  metadata,
  profile,
} from './turn-application.test-support';

describe('TurnApplicationService (tool kernel and approvals)', () => {
  it('让模型工具调用经过同一个Tool Kernel并绑定answer Model Run', async () => {
    const lifecycle = new MemoryLifecycle();
    const models = new MemoryModelRunLedger();
    const calls = new MemoryCallLedger();
    const adapter: ToolKernelAdapter<{ query: string }, { answer: string }> = {
      name: 'lookup',
      description: '查找受控资料',
      source: 'local',
      capability: 'tool.execute',
      risk: 'l0',
      exposure: 'model',
      effect: 'read',
      timeoutMs: 100,
      inputSchema: z.object({ query: z.string().max(100) }).strict(),
      outputSchema: z.object({ answer: z.string() }).strict(),
      async invoke() {
        return { answer: '已验证资料' };
      },
    };
    const withTools: TurnApplicationProfilePort = {
      ...profile(),
      async prepare(input) {
        const base = await profile().prepare(input);
        return {
          ...base,
          toolPolicy: {
            channel: 'web',
            environment: 'test',
            capabilities: {
              actor: ['tool.execute'],
              notebook: ['tool.execute'],
              profile: ['tool.execute'],
              channel: ['tool.execute'],
              environment: ['tool.execute'],
            },
            approvedCapabilities: [],
          },
        };
      },
    };
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        if (request.toolResults.length === 0) {
          yield {
            type: 'tool_call',
            phase: request.phase,
            callId: 'call_1',
            tool: 'lookup',
            argumentsDelta: '{"query":"数学"}',
            done: true,
          };
          yield {
            type: 'completed',
            phase: request.phase,
            metadata: metadata(request, 'tool_calls'),
          };
          return;
        }
        yield { type: 'text_delta', phase: request.phase, delta: '资料结果。' };
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
        profile: withTools,
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: models,
        modelGateway: gateway,
        toolKernel: new ToolKernel([adapter], calls, new MemoryEffectLedger()),
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'tool.started',
      'tool.completed',
      'message.delta',
      'turn.completed',
    ]);
    expect(models.runs).toHaveLength(2);
    expect(events.find((event) => event.type === 'tool.started')).toMatchObject(
      {
        tool: 'tool.execute',
      },
    );
    expect(calls.calls[0]?.answerModelRunId).toBe(models.runs[0]?.id);
    expect(calls.calls[0]?.status).toBe('succeeded');
  });

  it('L2工具准备耐久意图后发出approval.required且不写失败终态', async () => {
    const lifecycle = new MemoryLifecycle();
    const calls = new MemoryCallLedger();
    const traceStatuses: string[] = [];
    const prepareApproval = vi.fn(async () => ({
      approvalId: 'approval:turn-application',
      summary: '读取已配对设备中的白名单学习资料',
      expiresAt: '2026-07-21T01:00:00.000Z',
    }));
    const adapter: ToolKernelAdapter<
      { relativePath: string },
      { content: string }
    > = {
      name: 'readNodeFile',
      description: '读取已配对设备中的白名单文件',
      source: 'node',
      capability: 'filesystem.read_allowlisted',
      risk: 'l2',
      exposure: 'model',
      effect: 'read',
      timeoutMs: 100,
      inputSchema: z.object({ relativePath: z.string().max(1_024) }).strict(),
      outputSchema: z.object({ content: z.string() }).strict(),
      prepareApproval,
      async invoke() {
        throw new Error('批准前不得执行');
      },
    };
    const approvalProfile: TurnApplicationProfilePort = {
      ...profile(),
      async prepare(input) {
        const base = await profile().prepare(input);
        const capability = 'filesystem.read_allowlisted';
        return {
          ...base,
          toolPolicy: {
            channel: 'tui',
            environment: 'test',
            capabilities: {
              actor: [capability],
              notebook: [capability],
              profile: [capability],
              channel: [capability],
              environment: [capability],
            },
            approvedCapabilities: [],
          },
        };
      },
    };
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        yield {
          type: 'tool_call',
          phase: request.phase,
          callId: 'call_node_file',
          tool: 'readNodeFile',
          argumentsDelta: '{"relativePath":"algebra.md"}',
          done: true,
        };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'tool_calls'),
        };
      },
    };
    const events = await collect(
      new TurnApplicationService({
        lifecycle,
        profile: approvalProfile,
        contextLedger: new MemoryContextLedger(),
        modelRunLedger: new MemoryModelRunLedger(),
        modelGateway: gateway,
        toolKernel: new ToolKernel(
          [adapter],
          calls,
          new MemoryEffectLedger(),
          1_024,
          () => new Date('2026-07-21T00:00:00.000Z'),
        ),
        trace: {
          start() {
            return {
              event() {},
              end(status) {
                traceStatuses.push(status);
              },
            };
          },
        },
      }),
    );

    expect(events).toMatchObject([
      { type: 'turn.started' },
      { type: 'tool.started', tool: 'filesystem.read_allowlisted' },
      {
        type: 'approval.required',
        approvalId: 'approval:turn-application',
        capability: 'filesystem.read_allowlisted',
        risk: 'l2',
      },
    ]);
    expect(lifecycle.settlements).toHaveLength(0);
    expect(traceStatuses).toEqual(['suspended']);
    expect(JSON.stringify(events)).not.toContain('algebra.md');
    expect(calls.calls[0]).toMatchObject({ status: 'pending' });
    expect(prepareApproval).toHaveBeenCalledWith(
      { relativePath: 'algebra.md' },
      expect.objectContaining({ toolCallId: calls.calls[0]!.id }),
    );
  });
});
