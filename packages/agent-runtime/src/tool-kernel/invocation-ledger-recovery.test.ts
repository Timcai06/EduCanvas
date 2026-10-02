import { describe, expect, it, vi } from 'vitest';
import { ToolKernel } from '../tool-kernel';
import {
  adapter,
  context,
  MemoryCallLedger,
  MemoryEffectLedger,
} from './test-support';

describe('Tool invocation ledger recovery semantics', () => {
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

  it('returns a non-retryable unknown result when both ledgers fail to settle a dispatched write', async () => {
    const calls = new MemoryCallLedger();
    const effects = new MemoryEffectLedger();
    const callSettle = vi
      .spyOn(calls, 'settle')
      .mockRejectedValue(new Error('private_call_ledger_detail'));
    const effectSettle = vi
      .spyOn(effects, 'settle')
      .mockRejectedValue(new Error('private_effect_ledger_detail'));
    const invoke = vi.fn(() => {
      throw new Error('private_write_failure');
    });
    const kernel = new ToolKernel(
      [adapter({ effect: 'write', invoke })],
      calls,
      effects,
    );

    const result = await kernel.execute({
      tool: 'runLocal',
      arguments: { value: 'fixture' },
      context: context('both-settlements-fail'),
    });

    expect(result).toMatchObject({
      status: 'outcome_unknown',
      code: 'write_outcome_unknown',
      retryable: false,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(callSettle).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'outcome_unknown',
        code: 'write_outcome_unknown',
        retryable: false,
      }),
    );
    expect(effectSettle).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'outcome_unknown',
        code: 'write_outcome_unknown',
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(/private_(call|effect|write)_/);
  });

  it('records the call as unknown when effect settlement fails after a dispatched write throws', async () => {
    const calls = new MemoryCallLedger();
    const effects = new MemoryEffectLedger();
    vi.spyOn(effects, 'settle').mockRejectedValue(
      new Error('private_effect_settlement_detail'),
    );
    const invoke = vi.fn(() => {
      throw new Error('private_write_failure');
    });
    const kernel = new ToolKernel(
      [adapter({ effect: 'write', invoke })],
      calls,
      effects,
    );

    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'fixture' },
        context: context('effect-settlement-fails'),
      }),
    ).resolves.toMatchObject({
      status: 'outcome_unknown',
      code: 'write_outcome_unknown',
      retryable: false,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect([...calls.calls.values()]).toMatchObject([
      {
        status: 'outcome_unknown',
        code: 'write_outcome_unknown',
        retryable: false,
      },
    ]);
  });

  it('does not make a committed write retryable when call settlement fails after adapter success', async () => {
    const calls = new MemoryCallLedger();
    const effects = new MemoryEffectLedger();
    const settleEffect = effects.settle.bind(effects);
    const effectSettle = vi
      .spyOn(effects, 'settle')
      .mockImplementation(async (input) => {
        if (input.status === 'outcome_unknown')
          throw new Error('terminal_effect_cannot_be_downgraded');
        return settleEffect(input);
      });
    const settleCall = calls.settle.bind(calls);
    const callSettle = vi
      .spyOn(calls, 'settle')
      .mockRejectedValueOnce(new Error('private_call_settlement_detail'))
      .mockImplementation(settleCall);
    const invoke = vi.fn(() => ({ source: 'committed-write' }));
    const kernel = new ToolKernel(
      [adapter({ effect: 'write', invoke })],
      calls,
      effects,
    );

    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { value: 'fixture' },
        context: context('call-settlement-fails-after-success'),
      }),
    ).resolves.toMatchObject({
      status: 'outcome_unknown',
      code: 'write_outcome_unknown',
      retryable: false,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect([...effects.effects.values()]).toMatchObject([
      { status: 'committed' },
    ]);
    expect([...calls.calls.values()]).toMatchObject([
      { status: 'outcome_unknown', code: 'write_outcome_unknown' },
    ]);
    expect(effectSettle).toHaveBeenCalledTimes(2);
    expect(callSettle).toHaveBeenCalledTimes(2);
  });
});
