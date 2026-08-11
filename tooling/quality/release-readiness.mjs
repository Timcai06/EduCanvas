/** Canonical gate names shared by draft shape checks and strict release mode. */
export const REQUIRED_RELEASE_GATES = [
  'lint',
  'typecheck',
  'unit',
  'db-integration',
  'worker-integration',
  'build',
  'e2e',
  'security',
  'contract',
  'eval',
  'provider-smoke',
  'release-evidence',
];

const REQUIRED_SUPPLY_CHAIN = [
  'actions_pinned',
  'dependency_review',
  'container_digest',
  'migration_records',
];
const REQUIRED_EVALS = ['retrieval', 'tool-artifact', 'teaching-safety'];
const REQUIRED_BUDGETS = ['cost', 'latency', 'error_rate'];
const REQUIRED_SIGNOFFS = ['security', 'product', 'engineering'];

function numericMeasurements(value, output = []) {
  if (typeof value === 'number') output.push(value);
  else if (Array.isArray(value)) {
    for (const entry of value) numericMeasurements(entry, output);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) {
      numericMeasurements(entry, output);
    }
  }
  return output;
}

function requirePassed(errors, scope, entries, requiredNames) {
  if (!entries || typeof entries !== 'object') {
    errors.push(`release mode 缺少 ${scope}`);
    return;
  }
  const names = new Set([...requiredNames, ...Object.keys(entries)]);
  for (const name of names) {
    const entry = entries[name];
    if (entry?.status !== 'passed') {
      errors.push(
        `${scope} ${name} 必须 passed，实际为 ${entry?.status ?? 'missing'}`,
      );
    }
  }
}

/** Strict release decision checks; draft validation deliberately does not call this. */
export function validateReleaseReadiness(manifest, targetSha, errors) {
  if (!/^[0-9a-f]{40}$/i.test(targetSha ?? '') || /^0+$/.test(targetSha)) {
    errors.push('release mode 必须提供非零 40 位 --sha');
  } else if (manifest.baseline?.sha !== targetSha) {
    errors.push(
      `baseline.sha(${manifest.baseline?.sha ?? 'missing'}) 与目标 SHA(${targetSha}) 不一致`,
    );
  }
  if (manifest.status !== 'passed') {
    errors.push(
      `release mode 要求 manifest.status=passed，实际为 ${manifest.status}`,
    );
  }

  requirePassed(errors, 'gate', manifest.gates, REQUIRED_RELEASE_GATES);
  requirePassed(
    errors,
    'supply_chain',
    manifest.supply_chain,
    REQUIRED_SUPPLY_CHAIN,
  );
  requirePassed(errors, 'eval', manifest.eval, REQUIRED_EVALS);
  requirePassed(errors, 'budget', manifest.budget, REQUIRED_BUDGETS);
  requirePassed(
    errors,
    'migration',
    {
      fresh: manifest.migration?.fresh,
      upgrade: manifest.migration?.upgrade,
    },
    ['fresh', 'upgrade'],
  );

  for (const name of REQUIRED_SIGNOFFS) {
    const signoff = manifest.signoffs?.[name];
    if (!signoff?.signed || !signoff.by || !signoff.timestamp) {
      errors.push(`signoff ${name} 必须包含 signed=true、by 与 timestamp`);
    }
  }
  if (!manifest.evidence || Object.keys(manifest.evidence).length === 0) {
    errors.push('release mode 缺少 evidence 文件映射');
  }
  for (const name of REQUIRED_EVALS) {
    const measurements = numericMeasurements(manifest.eval?.[name]?.baseline);
    if (
      measurements.length === 0 ||
      measurements.every((value) => value === 0)
    ) {
      errors.push(`eval ${name} 缺少非零 baseline 测量`);
    }
  }
  for (const [name, gate] of Object.entries(manifest.gates ?? {})) {
    if (!gate.timestamp) errors.push(`gate ${name} 缺少终态 timestamp`);
  }
  for (const name of ['fresh', 'upgrade']) {
    if (!manifest.migration?.[name]?.timestamp) {
      errors.push(`migration.${name} 缺少终态 timestamp`);
    }
  }
}
