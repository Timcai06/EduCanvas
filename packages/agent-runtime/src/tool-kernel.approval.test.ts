import { describe, expect, it, vi } from 'vitest';
import { ToolKernel, toolPolicyDimensions } from './tool-kernel';
import {
  adapter,
  context,
  MemoryCallLedger,
  MemoryEffectLedger,
} from './tool-kernel.test-support';

describe('Tool Kernel审批边界', () => {
  it('五个权限维度逐一fail closed且L2必须先审批', async () => {
    const invoke = vi.fn(async () => ({ source: 'local' }));
    const prepareApproval = vi.fn(async () => ({
      approvalId: 'approval:tool-kernel',
      summary: '运行受控工具',
      expiresAt: '2026-07-21T01:00:00.000Z',
    }));
    const calls = new MemoryCallLedger();
    const kernel = new ToolKernel(
      [adapter({ risk: 'l2', invoke, prepareApproval })],
      calls,
      new MemoryEffectLedger(),
      1_024,
      () => new Date('2026-07-21T00:00:00.000Z'),
    );
    for (const dimension of toolPolicyDimensions) {
      const trusted = context(dimension);
      trusted.capabilities = { ...trusted.capabilities, [dimension]: [] };
      await expect(
        kernel.execute({
          tool: 'runLocal',
          arguments: { value: 'ok' },
          context: trusted,
        }),
      ).resolves.toMatchObject({
        status: 'denied',
        code: `capability_denied:${dimension}`,
      });
    }
    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 42 },
        context: context('invalid-before-approval'),
      }),
    ).resolves.toMatchObject({
      status: 'denied',
      code: 'invalid_arguments',
    });
    expect(prepareApproval).not.toHaveBeenCalled();
    expect(calls.calls.size).toBe(0);
    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'ok' },
        context: context('approval'),
        traceCarrier: {
          traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
        },
      }),
    ).resolves.toMatchObject({
      status: 'approval_required',
      code: 'approval_required',
      approval: {
        approvalId: 'approval:tool-kernel',
        capability: 'tool.execute',
        risk: 'l2',
        adapterSource: 'local',
      },
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(prepareApproval).toHaveBeenCalledWith(
      { value: 'ok' },
      expect.objectContaining({
        operationId: context('approval').operationId,
        toolCallId: expect.any(String),
        traceCarrier: {
          traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
        },
      }),
    );
    expect(calls.calls.size).toBe(1);
    expect([...calls.calls.values()][0]?.status).toBe('pending');

    const restartedKernel = new ToolKernel(
      [adapter({ risk: 'l2', invoke, prepareApproval })],
      calls,
      new MemoryEffectLedger(),
      1_024,
      () => new Date('2026-07-21T00:00:00.000Z'),
    );
    await expect(
      restartedKernel.execute({
        tool: 'runLocal',
        arguments: { value: 'ok' },
        context: context('approval'),
      }),
    ).resolves.toMatchObject({
      status: 'approval_required',
      replayed: true,
      approval: { approvalId: 'approval:tool-kernel' },
    });
    expect(prepareApproval).toHaveBeenCalledTimes(2);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('审批描述越界时稳定失败且不执行Adapter', async () => {
    const invoke = vi.fn(async () => ({ source: 'local' }));
    const calls = new MemoryCallLedger();
    const kernel = new ToolKernel(
      [
        adapter({
          risk: 'l2',
          invoke,
          prepareApproval: async () => ({
            approvalId: 'approval:invalid',
            summary: '越界审批',
            expiresAt: '2026-07-23T00:00:01.000Z',
          }),
        }),
      ],
      calls,
      new MemoryEffectLedger(),
      1_024,
      () => new Date('2026-07-21T00:00:00.000Z'),
    );
    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'ok' },
        context: context('invalid-approval'),
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      code: 'approval_preparation_failed',
    });
    expect(invoke).not.toHaveBeenCalled();
    expect([...calls.calls.values()][0]).toMatchObject({
      status: 'failed',
      code: 'approval_preparation_failed',
    });
  });

  it('审批准备前已取消时只结算审计账本且不创建审批', async () => {
    const prepareApproval = vi.fn(async () => ({
      approvalId: 'approval:cancelled',
      summary: '不应创建的审批',
      expiresAt: '2026-07-21T01:00:00.000Z',
    }));
    const invoke = vi.fn(async () => ({ source: 'local' }));
    const calls = new MemoryCallLedger();
    const controller = new AbortController();
    controller.abort('user_cancelled');
    const kernel = new ToolKernel(
      [adapter({ risk: 'l2', invoke, prepareApproval })],
      calls,
      new MemoryEffectLedger(),
      1_024,
      () => new Date('2026-07-21T00:00:00.000Z'),
    );

    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'ok' },
        context: context('cancel-before-approval'),
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({
      status: 'cancelled',
      code: 'tool_cancelled',
      retryable: false,
    });
    expect(prepareApproval).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect([...calls.calls.values()][0]).toMatchObject({
      status: 'failed',
      code: 'tool_cancelled',
    });
  });
});
