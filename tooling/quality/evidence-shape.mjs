const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export function validateEvidenceStatusValues(manifest) {
  const errors = [];
  const validStatuses = ['pending', 'running', 'passed', 'failed', 'skipped'];

  for (const [scope, entries] of [
    ['gate', manifest.gates],
    ['supply_chain', manifest.supply_chain],
    ['eval', manifest.eval],
    ['budget', manifest.budget],
    [
      'migration',
      manifest.migration && {
        fresh: manifest.migration.fresh,
        upgrade: manifest.migration.upgrade,
      },
    ],
  ]) {
    if (!entries) continue;

    for (const [name, entry] of Object.entries(entries)) {
      if (!validStatuses.includes(entry?.status)) {
        errors.push(
          `${scope} ${name} has invalid status: ${entry?.status ?? 'missing'}`,
        );
      }
    }
  }

  return errors;
}

export function validateEvidenceTimestamps(manifest) {
  const errors = [];

  if (
    manifest.baseline?.timestamp &&
    !ISO_TIMESTAMP.test(manifest.baseline.timestamp)
  ) {
    errors.push('baseline.timestamp is not ISO 8601 format');
  }

  for (const [name, gate] of Object.entries(manifest.gates ?? {})) {
    if (gate.timestamp && !ISO_TIMESTAMP.test(gate.timestamp)) {
      errors.push(`Gate ${name} timestamp is not ISO 8601 format`);
    }
  }

  for (const name of ['fresh', 'upgrade']) {
    const timestamp = manifest.migration?.[name]?.timestamp;
    if (timestamp && !ISO_TIMESTAMP.test(timestamp)) {
      errors.push(`migration.${name}.timestamp is not ISO 8601 format`);
    }
  }

  for (const [name, signoff] of Object.entries(manifest.signoffs ?? {})) {
    if (signoff?.timestamp && !ISO_TIMESTAMP.test(signoff.timestamp)) {
      errors.push(`signoff ${name} timestamp is not ISO 8601 format`);
    }
  }

  return errors;
}
