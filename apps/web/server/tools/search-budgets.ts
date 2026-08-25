/**
 * Provider discovery and candidate reachability are separate bounded phases.
 * Keep the Agent tool budget large enough to cover both without making either
 * network operation unbounded.
 */
export const SEARCH_PROVIDER_TIMEOUT_MS = 15_000;
export const SEARCH_TOTAL_BUDGET_MS = 30_000;
export const WEB_SEARCH_TOOL_TIMEOUT_MS = 45_000;
