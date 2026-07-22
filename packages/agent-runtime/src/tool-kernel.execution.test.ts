import { describe, expect, it, vi } from 'vitest';
import { ToolKernel } from './tool-kernel';
import {
  adapter,
  context,
  MemoryCallLedger,
  MemoryEffectLedger,
} from './tool-kernel.test-support';

describe('Tool Kernel执行与副作用边界', () => {
  it('相同executionId只执行一次，语义漂移拒绝', async () => {
    const invoke = vi.fn(async () => ({ source: 'local' }));
    const kernel = new ToolKernel(
      [adapter({ invoke })],
      new MemoryCallLedger(),
      new MemoryEffectLedger(),
    );
    const trusted = context('idem');
    const first = await kernel.execute({
      tool: 'runLocal',
      arguments: { value: 'same' },
      context: trusted,
    });
    const replay = await kernel.execute({
      tool: 'runLocal',
      arguments: { value: 'same' },
      context: trusted,
    });
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'changed' },
        context: trusted,
      }),
    ).resolves.toMatchObject({ code: 'idempotency_conflict' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('write超时先留intention并收敛为outcome_unknown', async () => {
    const calls = new MemoryCallLedger();
    const effects = new MemoryEffectLedger();
    const kernel = new ToolKernel(
      [
        adapter({
          effect: 'write',
          timeoutMs: 5,
          invoke: async () => new Promise(() => undefined),
        }),
      ],
      calls,
      effects,
    );
    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'secret-value' },
        context: context('timeout'),
      }),
    ).resolves.toMatchObject({
      status: 'outcome_unknown',
      code: 'write_outcome_unknown',
      retryable: false,
    });
    expect([...effects.effects.values()]).toMatchObject([
      { status: 'outcome_unknown', code: 'write_outcome_unknown' },
    ]);
    expect([...calls.calls.values()]).toMatchObject([
      { status: 'outcome_unknown', code: 'write_outcome_unknown' },
    ]);
    expect(JSON.stringify(effects.effects)).not.toContain('secret-value');
  });
});
