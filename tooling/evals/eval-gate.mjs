#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FORBIDDEN_REPORT_KEY =
  /(?:prompt|message|provider.?body|secret|api.?key|audio|student.?content)/i;

function loadJson(path) {
  if (!existsSync(path)) throw new Error(`missing evaluation input: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function assertSanitized(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertSanitized(entry, `${path}[${index}]`),
    );
    return;
  }
  if (typeof value === 'string') {
    if (/(?:bearer\s+|api[_-]?key\s*[:=]|\bsk-[a-z0-9]{12,})/i.test(value)) {
      throw new Error(`evaluation report contains secret-like text: ${path}`);
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_KEY.test(key)) {
      throw new Error(
        `evaluation report contains forbidden field: ${path}.${key}`,
      );
    }
    assertSanitized(entry, `${path}.${key}`);
  }
}

function metric(report, path) {
  let current = report;
  for (const segment of path.split('.')) current = current?.[segment];
  return current;
}

function compareThresholds(report, thresholds, prefix) {
  return Object.entries(thresholds).map(([path, minimum]) => {
    const actual = metric(report, path);
    return {
      metric: `${prefix}.${path}`,
      minimum,
      actual: typeof actual === 'number' ? actual : null,
      passed: typeof actual === 'number' && actual >= minimum,
    };
  });
}

export function evaluateReports({
  ragReport,
  ragBaseline,
  agentReport,
  agentBaseline,
  sha,
}) {
  assertSanitized(ragReport);
  assertSanitized(agentReport);
  if (ragReport.dataset?.version !== ragBaseline.datasetVersion) {
    throw new Error('RAG report and baseline dataset versions do not match');
  }
  if (agentReport.datasetVersion !== agentBaseline.datasetVersion) {
    throw new Error('Agent report and baseline dataset versions do not match');
  }
  const ragMetrics = {
    hybrid: ragReport.retrievers?.hybrid,
    fallbackHonesty: ragReport.fallbackHonesty?.matchesFts ? 1 : 0,
  };
  const agentMetrics = {
    toolArtifact: {
      passRate:
        agentReport.summary?.toolArtifact?.passed /
        agentReport.summary?.toolArtifact?.total,
    },
    teachingSafetyCritical: {
      passRate:
        agentReport.summary?.teachingSafetyCritical?.passed /
        agentReport.summary?.teachingSafetyCritical?.total,
    },
    teachingSafetyNonCritical: agentReport.summary?.teachingSafetyNonCritical,
  };
  const comparisons = [
    ...compareThresholds(ragMetrics, ragBaseline.thresholds, 'rag'),
    ...compareThresholds(agentMetrics, agentBaseline.thresholds, 'agent'),
  ];
  return {
    schemaVersion: 1,
    sha: sha ? sha.toLowerCase() : undefined,
    datasets: {
      rag: ragBaseline.datasetVersion,
      agent: agentBaseline.datasetVersion,
    },
    scope: [ragBaseline.scope, agentBaseline.scope],
    passed: comparisons.every((comparison) => comparison.passed),
    comparisons,
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const reportsDirectory = resolve(
    argument('--reports') ?? 'tooling/evals/reports',
  );
  const output = resolve(
    argument('--output') ?? `${reportsDirectory}/eval-gate-v1.json`,
  );
  const result = evaluateReports({
    ragReport: loadJson(`${reportsDirectory}/rag-eval-v1.json`),
    ragBaseline: loadJson(
      resolve(repoRoot, 'tooling/evals/baselines/rag-v1.json'),
    ),
    agentReport: loadJson(`${reportsDirectory}/agent-eval-agent-v1.json`),
    agentBaseline: loadJson(
      resolve(repoRoot, 'tooling/evals/baselines/agent-v1.json'),
    ),
    sha:
      argument('--sha') || process.env.EVIDENCE_SHA || process.env.GITHUB_SHA,
  });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  const summary = [
    '### Deterministic Agent Eval',
    '',
    `Overall: ${result.passed ? 'PASS' : 'FAIL'}`,
    '',
    ...result.comparisons.map(
      (entry) =>
        `- ${entry.passed ? 'PASS' : 'FAIL'} ${entry.metric}: ${entry.actual ?? 'missing'} (minimum ${entry.minimum})`,
    ),
    '',
    'Scope: frozen synthetic datasets; this does not claim real-course semantic quality.',
  ].join('\n');
  process.stdout.write(`${summary}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, {
      encoding: 'utf8',
      flag: 'a',
    });
  }
  if (!result.passed) process.exitCode = 1;
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
