import { describe, expect, it } from 'vitest';
import {
  createObservationEpochController,
  isPollOutcomeGenerating,
  phaseFromPollOutcome,
  outcomeFromPollOutcome,
} from './artifact-generation-flow';
import type { PollOutcome } from './artifact-polling-client';

describe('artifact generation flow polling state mapping', () => {
  it('轮询结果向可见 phase 映射：ready/failed/cancelled 与 pending 正确', () => {
    expect(phaseFromPollOutcome('ready')).toBe('ready');
    expect(phaseFromPollOutcome('failed')).toBe('failed');
    expect(phaseFromPollOutcome('cancelled')).toBe('failed');
    expect(phaseFromPollOutcome('timed_out')).toBe('generating');
    expect(phaseFromPollOutcome('pending')).toBe('generating');
    expect(isPollOutcomeGenerating('timed_out' as PollOutcome)).toBe(true);
  });

  it('轮询结果向 outcome 映射：cancelled 显式保留', () => {
    expect(outcomeFromPollOutcome('cancelled')).toBe('cancelled');
    expect(outcomeFromPollOutcome('ready')).toBe('ready');
    expect(outcomeFromPollOutcome('failed')).toBe('failed');
    expect(outcomeFromPollOutcome('timed_out')).toBe('pending');
  });

  it('A-B反序：旧 epoch 不可覆盖新观察状态', () => {
    const epoch = createObservationEpochController();
    const first = epoch.begin();
    const second = epoch.begin();
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(epoch.isCurrent(first)).toBe(false);
    expect(epoch.isCurrent(second)).toBe(true);
  });
});
