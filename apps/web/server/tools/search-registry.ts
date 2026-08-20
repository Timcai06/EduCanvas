import type { SearchProvider } from './search-contract';
import {
  ProviderHealthTracker,
  type ProviderHealthTrackerOptions,
} from './provider-health';

export interface RegisteredProvider {
  readonly provider: SearchProvider;
  readonly enabled: boolean;
}

export interface SearchProviderRegistryOptions {
  healthOptions?: ProviderHealthTrackerOptions;
  now?: () => Date;
}

export class SearchProviderRegistry {
  private readonly providers: RegisteredProvider[] = [];
  private readonly health: ProviderHealthTracker;

  constructor(options: SearchProviderRegistryOptions = {}) {
    this.health = new ProviderHealthTracker(options.healthOptions, options.now);
  }

  register(provider: SearchProvider, enabled = true): void {
    this.providers.push({ provider, enabled });
  }

  getProviderNames(): readonly string[] {
    return this.providers.map((p) => p.provider.name);
  }

  getAvailableProviders(): readonly SearchProvider[] {
    return this.providers
      .filter((p) => p.enabled && this.health.isAvailable(p.provider.name))
      .map((p) => p.provider);
  }

  recordSuccess(providerName: string): void {
    this.health.recordSuccess(providerName);
  }

  recordFailure(providerName: string): void {
    this.health.recordFailure(providerName);
  }
}
