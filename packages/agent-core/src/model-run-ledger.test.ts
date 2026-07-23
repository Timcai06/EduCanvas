import { describe, expect, it } from 'vitest';
import {
  agentModelRunStatuses,
  agentModelRunStatusSchema,
} from './model-run-ledger';

describe('Agent Model Run Ledger contract', () => {
  it('freezes the version-one lifecycle values', () => {
    expect(agentModelRunStatuses).toEqual([
      'pending',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'interrupted',
    ]);
    expect(agentModelRunStatusSchema.safeParse('outcome_unknown').success).toBe(
      false,
    );
  });
});
