#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expectedResultsFromEnvironment,
  laneResultsFromEnvironment,
  requiredResultFailures,
} from './ci-impact.mjs';

const SHA = /^[0-9a-f]{40}$/i;
const EVENTS = new Set([
  'pull_request',
  'push',
  'schedule',
  'workflow_dispatch',
]);

export function buildCiEvidence({
  sha,
  event,
  expected,
  results,
  generatedAt = new Date().toISOString(),
}) {
  if (!SHA.test(sha ?? '') || /^0+$/.test(sha)) {
    throw new Error('ci evidence requires a non-zero 40-character SHA');
  }
  if (!EVENTS.has(event)) {
    throw new Error(`unsupported CI event: ${event}`);
  }
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('generatedAt must be ISO-8601 compatible');
  }
  return {
    schemaVersion: 1,
    sha: sha.toLowerCase(),
    event,
    expected: { ...expected },
    results: { ...results },
    requiredFailures: requiredResultFailures({
      eventName: event,
      expected,
      results,
    }),
    generatedAt,
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const output = argument('--output');
  if (!output) throw new Error('--output is required');
  const evidence = buildCiEvidence({
    sha: argument('--sha'),
    event: argument('--event'),
    expected: expectedResultsFromEnvironment(),
    results: laneResultsFromEnvironment(),
  });
  const outputPath = resolve(output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `CI evidence recorded for ${evidence.sha.slice(0, 8)} with ${evidence.requiredFailures.length} required failure(s).\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
