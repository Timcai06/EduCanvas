import { describe, expect, it, vi } from 'vitest';
import { ToolKernel } from '../tool-kernel';
import {
  adapter,
  context,
  MemoryCallLedger,
  MemoryEffectLedger,
} from './test-support';

describe('Tool invocation failure audit semantics', () => {
  it.each(['read', 'write'] as const)(
    'ordinary %s throw is classified safely in both ledger and Kernel without reading raw details',
    async (effect) => {
      const calls = new MemoryCallLedger();
      const effects = new MemoryEffectLedger();
      const settled = vi.spyOn(calls, 'settle');
      const error = new Error('private_scope_mismatch');
      const readers = [
        'message',
        'stack',
        'body',
        'url',
        'prompt',
        'apiKey',
      ].map((property) => {
        const reader = vi.fn(() => {
          throw new Error('forbidden sensitive getter');
        });
        Object.defineProperty(error, property, { get: reader });
        return reader;
      });
      const invoke = vi.fn(() => {
        throw error;
      });
      const kernel = new ToolKernel(
        [adapter({ effect, invoke })],
        calls,
        effects,
      );
      const result = await kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'fixture' },
        context: context(`ordinary-${effect}`),
      });
      expect(result).toMatchObject(
        effect === 'write'
          ? {
              status: 'outcome_unknown',
              code: 'write_outcome_unknown',
              retryable: false,
            }
          : { status: 'failed', code: 'tool_failed', retryable: false },
      );
      expect(settled).toHaveBeenCalledWith(
        expect.objectContaining({
          status: effect === 'write' ? 'outcome_unknown' : 'failed',
          code: effect === 'write' ? 'write_outcome_unknown' : 'tool_failed',
          retryable: false,
        }),
      );
      expect(calls.calls.size).toBe(1);
      expect([...calls.calls.values()][0]).toMatchObject(
        effect === 'write'
          ? {
              status: 'outcome_unknown',
              code: 'write_outcome_unknown',
            }
          : { status: 'failed', code: 'tool_failed' },
      );
      expect(invoke).toHaveBeenCalledTimes(1);
      if (effect === 'write') {
        expect([...calls.calls.values()][0]).toMatchObject({
          status: 'outcome_unknown',
          code: 'write_outcome_unknown',
          retryable: false,
        });
        expect([...effects.effects.values()][0]).toMatchObject({
          status: 'outcome_unknown',
          code: 'write_outcome_unknown',
        });
      }
      for (const reader of readers) expect(reader).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain('private_scope_mismatch');
    },
  );

  it('invalid arguments and unknown tools do not manufacture execution ledger or write intentions', async () => {
    const calls = new MemoryCallLedger();
    const effects = new MemoryEffectLedger();
    const invoke = vi.fn(() => ({ source: 'local' }));
    const kernel = new ToolKernel(
      [adapter({ effect: 'write', invoke })],
      calls,
      effects,
    );
    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 42 },
        context: context('bad-arguments'),
      }),
    ).resolves.toMatchObject({
      status: 'denied',
      code: 'invalid_arguments',
      retryable: false,
    });
    await expect(
      kernel.execute({
        tool: 'unknownTool',
        arguments: { value: 'fixture' },
        context: context('unknown-tool'),
      }),
    ).resolves.toMatchObject({
      status: 'denied',
      code: 'tool_not_available',
      retryable: false,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(calls.calls.size).toBe(0);
    expect(effects.effects.size).toBe(0);
  });

  it('read timeout retains its retryable ledger and Kernel semantics', async () => {
    const calls = new MemoryCallLedger();
    const settled = vi.spyOn(calls, 'settle');
    const kernel = new ToolKernel(
      [adapter({ timeoutMs: 5, invoke: () => new Promise(() => {}) })],
      calls,
      new MemoryEffectLedger(),
    );
    const result = await kernel.execute({
      tool: 'runLocal',
      arguments: { value: 'fixture' },
      context: context('read-timeout'),
    });
    expect(result).toMatchObject({
      status: 'timed_out',
      code: 'tool_timeout',
      retryable: true,
    });
    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        code: 'tool_timeout',
        retryable: true,
      }),
    );
  });

  it('read cancellation after dispatch retains its existing retryable semantics', async () => {
    const calls = new MemoryCallLedger();
    const settled = vi.spyOn(calls, 'settle');
    const controller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const kernel = new ToolKernel(
      [
        adapter({
          invoke: () => {
            markStarted();
            return new Promise(() => {});
          },
        }),
      ],
      calls,
      new MemoryEffectLedger(),
    );
    const pending = kernel.execute({
      tool: 'runLocal',
      arguments: { value: 'fixture' },
      context: context('read-cancelled'),
      signal: controller.signal,
    });
    await started;
    controller.abort('user_cancelled');
    expect(await pending).toMatchObject({
      status: 'cancelled',
      code: 'tool_cancelled',
      retryable: true,
    });
    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        code: 'tool_cancelled',
        retryable: true,
      }),
    );
  });

  it('fails closed and settles the call ledger when write intent persistence fails before dispatch', async () => {
    const calls = new MemoryCallLedger();
    const effects = new MemoryEffectLedger();
    vi.spyOn(effects, 'intend').mockRejectedValue(
      new Error('private_db_detail'),
    );
    const invoke = vi.fn(() => ({ source: 'should-not-run' }));
    const kernel = new ToolKernel(
      [adapter({ effect: 'write', invoke })],
      calls,
      effects,
    );

    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'fixture' },
        context: context('intent-ledger-failure'),
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      code: 'ledger_unavailable',
      retryable: false,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect([...calls.calls.values()]).toMatchObject([
      { status: 'failed', code: 'ledger_unavailable', retryable: false },
    ]);
    expect(effects.effects.size).toBe(0);
  });

  it('records a terminal call failure when claiming the pending call fails before dispatch', async () => {
    const calls = new MemoryCallLedger();
    vi.spyOn(calls, 'markRunning').mockRejectedValue(
      new Error('private claim backend detail'),
    );
    const effects = new MemoryEffectLedger();
    const invoke = vi.fn(() => ({ source: 'should-not-run' }));
    const kernel = new ToolKernel(
      [adapter({ effect: 'read', invoke })],
      calls,
      effects,
    );

    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'fixture' },
        context: context('claim-ledger-failure'),
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      code: 'ledger_unavailable',
      retryable: false,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect([...calls.calls.values()]).toMatchObject([
      { status: 'failed', code: 'ledger_unavailable', retryable: false },
    ]);
    expect(effects.effects.size).toBe(0);
  });
});
