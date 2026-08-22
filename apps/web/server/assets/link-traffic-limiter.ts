import 'server-only';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 20;
const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_KEYS = 10_000;
const CONCURRENCY_RETRY_AFTER_MS = 1_000;

export interface LinkTrafficLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
  maxConcurrent?: number;
  maxKeys?: number;
}

export type LinkTrafficRejection = {
  allowed: false;
  reason: 'rate' | 'concurrency';
  retryAfterMs: number;
};

export type LinkTrafficLease = {
  allowed: true;
  release: () => void;
};

type TrafficState = {
  windowStartedAt: number;
  requestCount: number;
  activeCount: number;
  lastSeenAt: number;
};

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

/**
 * Process-local actor + Notebook boundary shared by search and direct imports.
 * The caller must release an accepted lease in finally so rejected/failed work
 * cannot permanently consume the Notebook's concurrent-operation budget.
 */
export class LinkTrafficLimiter {
  private readonly states = new Map<string, TrafficState>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxConcurrent: number;
  private readonly maxKeys: number;

  constructor(options: LinkTrafficLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
    assertPositiveInteger('windowMs', this.windowMs);
    assertPositiveInteger('maxRequests', this.maxRequests);
    assertPositiveInteger('maxConcurrent', this.maxConcurrent);
    assertPositiveInteger('maxKeys', this.maxKeys);
  }

  acquire(
    key: string,
    now = Date.now(),
  ): LinkTrafficLease | LinkTrafficRejection {
    const normalizedKey = key.trim();
    if (!normalizedKey) throw new Error('link traffic key must not be empty');
    this.prune(now);

    let state = this.states.get(normalizedKey);
    if (!state) {
      if (this.states.size >= this.maxKeys && !this.evictOldest()) {
        return {
          allowed: false,
          reason: 'concurrency',
          retryAfterMs: CONCURRENCY_RETRY_AFTER_MS,
        };
      }
      state = {
        windowStartedAt: now,
        requestCount: 0,
        activeCount: 0,
        lastSeenAt: now,
      };
      this.states.set(normalizedKey, state);
    } else if (now - state.windowStartedAt >= this.windowMs) {
      state.windowStartedAt = now;
      state.requestCount = 0;
      state.lastSeenAt = now;
    }

    if (state.requestCount >= this.maxRequests) {
      return {
        allowed: false,
        reason: 'rate',
        retryAfterMs: Math.max(1, state.windowStartedAt + this.windowMs - now),
      };
    }
    if (state.activeCount >= this.maxConcurrent) {
      return {
        allowed: false,
        reason: 'concurrency',
        retryAfterMs: CONCURRENCY_RETRY_AFTER_MS,
      };
    }

    state.requestCount += 1;
    state.activeCount += 1;
    state.lastSeenAt = now;
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        state!.activeCount = Math.max(0, state!.activeCount - 1);
        state!.lastSeenAt = Date.now();
      },
    };
  }

  private prune(now: number): void {
    for (const [key, state] of this.states) {
      if (
        state.activeCount === 0 &&
        state.windowStartedAt + this.windowMs <= now
      ) {
        this.states.delete(key);
      }
    }
  }

  private evictOldest(): boolean {
    let oldestKey: string | undefined;
    let oldestSeenAt = Number.POSITIVE_INFINITY;
    for (const [key, state] of this.states) {
      if (state.activeCount === 0 && state.lastSeenAt < oldestSeenAt) {
        oldestKey = key;
        oldestSeenAt = state.lastSeenAt;
      }
    }
    if (oldestKey === undefined) return false;
    this.states.delete(oldestKey);
    return true;
  }
}

export function linkTrafficKey(
  trustedSubjectId: string,
  notebookId: string,
): string {
  const subject = trustedSubjectId.trim();
  const notebook = notebookId.trim();
  if (!subject || !notebook)
    throw new Error('link traffic identity is invalid');
  return `${subject}\u0000${notebook}`;
}

export const linkTrafficLimiter = new LinkTrafficLimiter();
