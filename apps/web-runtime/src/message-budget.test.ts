import { describe, expect, it } from 'vitest';
import {
  MAX_RUNTIME_MESSAGE_BYTES,
  MAX_RUNTIME_MESSAGES_PER_SECOND,
  MAX_RUNTIME_OUTPUT_BYTES,
  consumeRuntimeMessageBudget,
  type RuntimeMessageBudgetState,
} from './message-budget';

const initial: RuntimeMessageBudgetState = {
  rateWindowStarted: 0,
  rateWindowMessages: 0,
  outputBytes: 0,
};

describe('runtime host message quotas', () => {
  it('fails closed above the 64 KiB serialized-message limit', () => {
    expect(
      consumeRuntimeMessageBudget(initial, {
        now: 1,
        messageBytes: MAX_RUNTIME_MESSAGE_BYTES + 1,
        outputBytes: 0,
      }),
    ).toEqual({ ok: false, code: 'resource_quota_exceeded' });
  });

  it('accepts 30 messages per second and rejects the 31st', () => {
    let state = initial;
    for (let index = 0; index < MAX_RUNTIME_MESSAGES_PER_SECOND; index += 1) {
      const result = consumeRuntimeMessageBudget(state, {
        now: 500,
        messageBytes: 1,
        outputBytes: 0,
      });
      expect(result.ok).toBe(true);
      if (result.ok) state = result.state;
    }
    expect(
      consumeRuntimeMessageBudget(state, {
        now: 500,
        messageBytes: 1,
        outputBytes: 0,
      }),
    ).toEqual({ ok: false, code: 'resource_quota_exceeded' });
    expect(
      consumeRuntimeMessageBudget(state, {
        now: 1_001,
        messageBytes: 1,
        outputBytes: 0,
      }).ok,
    ).toBe(true);
  });

  it('fails closed once cumulative output exceeds 1 MiB', () => {
    const atLimit = consumeRuntimeMessageBudget(initial, {
      now: 1,
      messageBytes: 1,
      outputBytes: MAX_RUNTIME_OUTPUT_BYTES,
    });
    expect(atLimit.ok).toBe(true);
    expect(
      consumeRuntimeMessageBudget(atLimit.ok ? atLimit.state : initial, {
        now: 1_001,
        messageBytes: 1,
        outputBytes: 1,
      }),
    ).toEqual({ ok: false, code: 'resource_quota_exceeded' });
  });
});
