import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createObservationEpochController,
  pollArtifactToTerminal,
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
    expect(outcomeFromPollOutcome('timed_out')).toBe('timed_out');
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

  it('stuck job reaches timed_out within the production poll bound', async () => {
    const stuckDetail = {
      artifact: {
        id: 'artifact-1',
        kind: 'mind_map',
        trustTier: 'tier1',
        title: '生成中的思维导图',
        status: 'proposed',
        latestVersion: 0,
        fromConversation: true,
        createdAt: '2026-08-13T00:00:00.000Z',
        updatedAt: '2026-08-13T00:00:00.000Z',
      },
      version: null,
      versions: [],
      latestJob: {
        id: '00000000-0000-4000-8000-000000000002',
        status: 'running',
        progress: 10,
        failureCode: null,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify(stuckDetail), { status: 200 }),
      ),
    );
    const startedAt = Date.now();

    const result = await pollArtifactToTerminal('artifact-1', {
      totalTimeoutMs: 30,
      windowTimeoutMs: 10,
      initialIntervalMs: 1,
      maxIntervalMs: 2,
      maxPollWindows: 3,
    });

    expect(result.outcome).toBe('timed_out');
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
