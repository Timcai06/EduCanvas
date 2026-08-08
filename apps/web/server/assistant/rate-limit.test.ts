import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { checkAssistantRateLimit, resetAssistantRateLimit } from './rate-limit';

describe('assistant rate limit', () => {
  beforeEach(() => {
    resetAssistantRateLimit();
  });

  it('同一主体在窗口内允许 10 次并拒绝第 11 次', () => {
    for (let count = 0; count < 10; count += 1) {
      expect(checkAssistantRateLimit('assistant:student', 1_000)).toEqual({
        allowed: true,
      });
    }

    expect(checkAssistantRateLimit('assistant:student', 1_000)).toEqual({
      allowed: false,
      retryAfterMs: 60_000,
    });
  });

  it('窗口结束后恢复且不同主体互不影响', () => {
    for (let count = 0; count < 10; count += 1) {
      checkAssistantRateLimit('assistant:first', 1_000);
    }

    expect(checkAssistantRateLimit('assistant:second', 1_000)).toEqual({
      allowed: true,
    });
    expect(checkAssistantRateLimit('assistant:first', 61_000)).toEqual({
      allowed: true,
    });
  });
});
