import { describe, expect, it } from 'vitest';
import {
  agentToolCallStatusSchema,
  agentToolEffectSchema,
  agentToolExposureSchema,
} from './tool-call-ledger';

describe('Agent Tool Call账本契约', () => {
  it('冻结调用生命周期、暴露边界和副作用分类', () => {
    expect(agentToolCallStatusSchema.safeParse('outcome_unknown').success).toBe(
      true,
    );
    expect(agentToolCallStatusSchema.safeParse('cancelled').success).toBe(
      false,
    );
    expect(agentToolExposureSchema.safeParse('model').success).toBe(true);
    expect(agentToolExposureSchema.safeParse('provider').success).toBe(false);
    expect(agentToolEffectSchema.safeParse('write').success).toBe(true);
    expect(agentToolEffectSchema.safeParse('unknown').success).toBe(false);
  });
});
