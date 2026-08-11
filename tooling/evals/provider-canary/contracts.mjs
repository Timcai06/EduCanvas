const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SAFE_ERROR = /^[A-Z][A-Z0-9_]{0,63}$/;
const FORBIDDEN_SUMMARY_KEY =
  /(?:prompt|provider.?body|secret|api.?key|audio|transcript|raw.?text)/i;
const SECRET_LIKE_TEXT = /(?:bearer\s+|api[_-]?key\s*[:=]|\bsk-[a-z0-9]{12,})/i;

export const MAX_PROVIDER_CANARY_SCENARIOS = 5;
export const MAX_PROVIDER_TURNS_PER_SCENARIO = 2;

export function validateProviderCanaryInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('canary input must be an object');
  }
  const keys = Object.keys(value).sort();
  const expected = [
    'datasetVersion',
    'scenarios',
    'schemaVersion',
    'turnsPerScenario',
  ];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error('canary input has unsupported fields');
  }
  if (value.schemaVersion !== 1 || !SAFE_ID.test(value.datasetVersion ?? '')) {
    throw new Error('canary input identity is invalid');
  }
  if (
    !Number.isInteger(value.turnsPerScenario) ||
    value.turnsPerScenario < 1 ||
    value.turnsPerScenario > MAX_PROVIDER_TURNS_PER_SCENARIO
  ) {
    throw new Error('canary turns-per-scenario budget exceeded');
  }
  if (
    !Array.isArray(value.scenarios) ||
    value.scenarios.length < 1 ||
    value.scenarios.length > MAX_PROVIDER_CANARY_SCENARIOS
  ) {
    throw new Error('canary scenario budget exceeded');
  }
  const ids = new Set();
  for (const scenario of value.scenarios) {
    if (
      !scenario ||
      typeof scenario !== 'object' ||
      Array.isArray(scenario) ||
      Object.keys(scenario).sort().join(',') !== 'id,text' ||
      !SAFE_ID.test(scenario.id ?? '') ||
      typeof scenario.text !== 'string' ||
      scenario.text.trim().length < 1 ||
      [...scenario.text].length > 500 ||
      ids.has(scenario.id)
    ) {
      throw new Error('canary scenario is invalid');
    }
    ids.add(scenario.id);
  }
  return value;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function assertSanitized(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertSanitized(entry, `${path}[${index}]`),
    );
    return;
  }
  if (typeof value === 'string') {
    if (SECRET_LIKE_TEXT.test(value)) {
      throw new Error(`canary summary contains secret-like text at ${path}`);
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_SUMMARY_KEY.test(key)) {
      throw new Error(
        `canary summary contains forbidden field at ${path}.${key}`,
      );
    }
    assertSanitized(entry, `${path}.${key}`);
  }
}

export function buildProviderCanarySummary({
  sha,
  datasetVersion,
  turnsPerScenario,
  results,
  generatedAt = new Date().toISOString(),
}) {
  if (!/^[0-9a-f]{40}$/i.test(sha ?? '') || /^0+$/.test(sha)) {
    throw new Error('canary summary requires a non-zero 40-character SHA');
  }
  if (!SAFE_ID.test(datasetVersion ?? '')) {
    throw new Error('canary dataset identity is invalid');
  }
  if (
    !Number.isInteger(turnsPerScenario) ||
    turnsPerScenario < 1 ||
    !Number.isFinite(Date.parse(generatedAt)) ||
    !Array.isArray(results) ||
    results.length < 1 ||
    results.length > MAX_PROVIDER_CANARY_SCENARIOS ||
    turnsPerScenario > MAX_PROVIDER_TURNS_PER_SCENARIO
  ) {
    throw new Error('canary result budget exceeded');
  }
  const stableErrorCounts = new Map();
  const scenarioIds = new Set();
  for (const result of results) {
    if (!SAFE_ID.test(result.id ?? '') || scenarioIds.has(result.id)) {
      throw new Error('invalid scenario id');
    }
    scenarioIds.add(result.id);
    if (!['passed', 'failed'].includes(result.status)) {
      throw new Error('invalid scenario status');
    }
    if (!Number.isFinite(result.latencyMs) || result.latencyMs < 0) {
      throw new Error('invalid scenario latency');
    }
    if (
      !Number.isFinite(result.roundTripSimilarity) ||
      result.roundTripSimilarity < 0 ||
      result.roundTripSimilarity > 1
    ) {
      throw new Error('invalid round-trip similarity');
    }
    if (result.stableErrorCode !== null) {
      if (!SAFE_ERROR.test(result.stableErrorCode ?? '')) {
        throw new Error('invalid stable error code');
      }
      stableErrorCounts.set(
        result.stableErrorCode,
        (stableErrorCounts.get(result.stableErrorCode) ?? 0) + 1,
      );
    }
    if (
      (result.status === 'passed' && result.stableErrorCode !== null) ||
      (result.status === 'failed' && result.stableErrorCode === null)
    ) {
      throw new Error('scenario status and stable error are inconsistent');
    }
  }
  const latencies = results.map((result) => Math.round(result.latencyMs));
  const passed = results.filter((result) => result.status === 'passed').length;
  const summary = {
    schemaVersion: 1,
    sha: sha.toLowerCase(),
    datasetVersion,
    scenarioCount: results.length,
    turnCount: results.length * turnsPerScenario,
    successRate: passed / results.length,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
    },
    stableErrors: [...stableErrorCounts]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([code, count]) => ({ code, count })),
    scenarios: results.map((result) => ({
      id: result.id,
      status: result.status,
      latencyMs: Math.round(result.latencyMs),
      roundTripSimilarity: result.roundTripSimilarity,
      stableErrorCode: result.stableErrorCode,
    })),
    generatedAt,
  };
  assertSanitized(summary);
  return summary;
}

export function validateSanitizedProviderCanarySummary(summary) {
  assertSanitized(summary);
  return true;
}
