import type { ProviderHealth } from './search-contract';

const DEFAULT_COOLDOWN_MS = 60_000;
const FAILURE_THRESHOLD = 3;

export interface ProviderHealthTrackerOptions {
  cooldownMs?: number;
  failureThreshold?: number;
}

export class ProviderHealthTracker {
  private readonly states = new Map<
    string,
    {
      consecutiveFailures: number;
      lastFailureAt?: Date;
      cooldownExpiresAt?: Date;
    }
  >();

  private readonly cooldownMs: number;
  private readonly failureThreshold: number;

  constructor(
    options: ProviderHealthTrackerOptions = {},
    private readonly now: () => Date = () => new Date(),
  ) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.failureThreshold = options.failureThreshold ?? FAILURE_THRESHOLD;
  }

  getStatus(providerName: string): ProviderHealth {
    const state = this.states.get(providerName);
    if (!state) {
      return {
        status: 'healthy',
        consecutiveFailures: 0,
      };
    }
    const current = this.now();
    if (state.cooldownExpiresAt && current < state.cooldownExpiresAt) {
      return {
        status: 'cooldown',
        consecutiveFailures: state.consecutiveFailures,
        lastFailureAt: state.lastFailureAt,
        cooldownExpiresAt: state.cooldownExpiresAt,
      };
    }
    if (state.cooldownExpiresAt && current >= state.cooldownExpiresAt) {
      return {
        status: 'healthy',
        consecutiveFailures: state.consecutiveFailures,
        lastFailureAt: state.lastFailureAt,
      };
    }
    return {
      status:
        state.consecutiveFailures >= this.failureThreshold
          ? 'cooldown'
          : 'healthy',
      consecutiveFailures: state.consecutiveFailures,
      lastFailureAt: state.lastFailureAt,
      cooldownExpiresAt: state.cooldownExpiresAt,
    };
  }

  recordSuccess(providerName: string): void {
    this.states.delete(providerName);
  }

  recordFailure(providerName: string): void {
    const current = this.now();
    const existing = this.states.get(providerName);
    const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;
    const cooldownExpiresAt =
      consecutiveFailures >= this.failureThreshold
        ? new Date(current.getTime() + this.cooldownMs)
        : undefined;
    this.states.set(providerName, {
      consecutiveFailures,
      lastFailureAt: current,
      cooldownExpiresAt,
    });
  }

  isAvailable(providerName: string): boolean {
    const health = this.getStatus(providerName);
    return health.status !== 'cooldown' && health.status !== 'disabled';
  }
}
