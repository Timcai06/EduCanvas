#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const LANES = [
  'checks',
  'db_integration',
  'worker_integration',
  'migration_integration',
  'windows',
  'runtime_pressure',
  'e2e',
  'agent_eval',
  'dependency_review',
  'release_evidence',
  'desktop',
];
const ALL = Object.fromEntries(LANES.map((lane) => [lane, true]));
const NONE = Object.fromEntries(LANES.map((lane) => [lane, false]));
const DOC_ONLY =
  /^docs\/.*\.md$|^(?:README|AGENTS|CLAUDE)\.md$|^(?:apps|packages|tooling)\/[^/]+\/README\.md$|^\.vscode\/(?:settings|extensions)\.json$|^\.github\/CODEOWNERS$/;
// Root dependency graph and executable Actions changes can affect every lane.
// Workspace-local manifests are routed by their owning product surface below;
// treating every package.json as global made Desktop-only changes pay for DB,
// Worker, Runtime and Web E2E without adding relevant evidence.
const GLOBAL_DEPENDENCY =
  /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$|^\.github\/(?:workflows|actions)\//;
const SCOPED_PACKAGE_MANIFEST = /^(?:apps|packages)\/[^/]+\/package\.json$/;
const ANY_PACKAGE_MANIFEST = /(?:^|\/)package\.json$/;
const RELEASE_EVIDENCE =
  /^docs\/06-quality\/releases\/|^docs\/06-quality\/08-|^tooling\/quality\/(?:validate-evidence|migration-records)\.mjs$|^packages\/db\/drizzle\//;

function matchesAny(paths, patterns) {
  return paths.some((path) => patterns.some((pattern) => pattern.test(path)));
}

export function classifyChangedPaths(
  paths,
  { eventName = 'pull_request' } = {},
) {
  // Scheduled and manually dispatched runs are full-matrix evidence events.
  // Do not let a missing comparison SHA turn that contract into an accidental
  // fail-open: both events intentionally pay every lane.
  if (eventName === 'schedule' || eventName === 'workflow_dispatch')
    return { ...ALL };
  if (paths.length === 0) return { ...ALL };
  const knownRoots = new Set([
    '.github',
    '.vscode',
    'apps',
    'config',
    'docs',
    'infrastructure',
    'packages',
    'scripts',
    'tests',
    'tooling',
  ]);
  const hasUnknownLocation = paths.some((path) => {
    const [root] = path.split('/');
    return path.includes('/')
      ? !knownRoots.has(root)
      : ![
          '.editorconfig',
          '.gitattributes',
          '.gitignore',
          '.gitleaksignore',
          '.nvmrc',
          'AGENTS.md',
          'CLAUDE.md',
          'Makefile',
          'README.md',
          'Start EduCanvas.cmd',
          'Stop EduCanvas.cmd',
          'package.json',
          'pnpm-lock.yaml',
          'pnpm-workspace.yaml',
          'tsconfig.base.json',
          'turbo.json',
        ].includes(path);
  });
  if (hasUnknownLocation) return { ...ALL };
  const releaseEvidenceAffected = matchesAny(paths, [RELEASE_EVIDENCE]);
  if (!releaseEvidenceAffected && paths.every((path) => DOC_ONLY.test(path)))
    return { ...NONE };
  if (
    paths.some(
      (path) =>
        GLOBAL_DEPENDENCY.test(path) ||
        (ANY_PACKAGE_MANIFEST.test(path) &&
          !SCOPED_PACKAGE_MANIFEST.test(path)),
    )
  )
    return { ...ALL };

  const result = { ...NONE, checks: true };
  result.release_evidence = releaseEvidenceAffected;
  // D06：CI 套件级分流——原单一 integration lane 拆为三个语义独立的证据：
  //   db_integration：packages/db（不含 drizzle）→ DB integration；
  //   worker_integration：apps/worker + packages/asset-processing → Worker integration；
  //   migration_integration：packages/db/drizzle/** 与 migration 治理 → Migration 证据。
  // 纯 DB 内部改动不自动支付 Worker integration；纯 Worker 改动不自动运行 DB full。
  const dbAffected = matchesAny(paths, [
    /^packages\/db\//,
    /^tests\/integration\//,
    /^infrastructure\/compose\/local\.yml$/,
  ]);
  const migrationAffected = matchesAny(paths, [
    /^packages\/db\/drizzle\//,
    /^packages\/db\/src\/schema\//,
    /^packages\/db\/src\/migrations\.integration\.test\.ts$/,
    /^tooling\/quality\/migration-(?:governance|integration|records)\.mjs$/,
    /^tooling\/quality\/migration-(?:governance|records)\.test\.mjs$/,
  ]);
  const workerAffected = matchesAny(paths, [
    /^apps\/worker\//,
    /^packages\/asset-processing\//,
    /^tests\/integration\//,
  ]);
  result.db_integration = dbAffected;
  result.migration_integration = migrationAffected;
  result.worker_integration = workerAffected;
  result.windows = matchesAny(paths, [
    /^(?:Start|Stop) EduCanvas\.cmd$/,
    /^scripts\/windows\/(?:start|stop)-educanvas\.ps1$/,
    /^config\/env\/local\.env\.example$/,
    /^apps\/node\//,
    /^packages\/(?:node-host|node-runtime)\//,
    /^tooling\/local\//,
  ]);
  result.runtime_pressure = matchesAny(paths, [
    /^apps\/web-runtime\//,
    /^packages\/(?:canvas-protocol|experiment-runtime|gateway-runtime)\//,
    /^apps\/web\/(?:app\/api\/runtime|features\/canvas|server\/runtime)/,
    /^tooling\/playwright\/playwright\.runtime(?:-composition)?\.config\.ts$/,
    /^tests\/e2e\/.*runtime/,
    /^tooling\/.*runtime/,
  ]);
  // D06：e2e 只对浏览器可执行面触发——纯 DB/Worker/asset-processing 内部改动
  // 不自动支付 Chromium E2E（路由原则 1/3/4）；其余 packages（browser-facing）
  // 保持 E2E smoke；未知路径 fail open。
  const NON_BROWSER_ONLY =
    /^(?:apps\/worker\/|packages\/(?:db|asset-processing)\/|tests\/integration\/)/;
  const browserPatterns = [
    /^apps\/(?:gateway|web|web-runtime)\//,
    /^packages\//,
    /^tests\/e2e\//,
    /^tooling\/playwright\/playwright(?:\..+)?\.config\.ts$/,
    /^infrastructure\/compose\/local\.yml$/,
    /^tooling\/(?:e2e\/|quality\/bundle-size)/,
  ];
  result.e2e = paths.some(
    (path) =>
      !NON_BROWSER_ONLY.test(path) &&
      browserPatterns.some((pattern) => pattern.test(path)),
  );
  result.agent_eval = matchesAny(paths, [
    /^packages\/(?:agent-core|agent-runtime|teaching-core|teaching-runtime|mcp-runtime|canvas-protocol)\//,
    /^packages\/model-gateway\//,
    /^packages\/db\/src\/(?:knowledge-|schema\/knowledge)/,
    /^apps\/web\/server\/(?:platform\/general-turn|teaching\/(?:knowledge-|learning-turn|turn-application))/,
    /^apps\/web\/app\/api\/v1\/(?:chat|learn)\/turn\//,
    /^tooling\/evals\//,
  ]);
  result.dependency_review = matchesAny(paths, [SCOPED_PACKAGE_MANIFEST]);
  result.desktop = matchesAny(paths, [/^apps\/desktop\//]);
  return result;
}

export function requiredResultFailures({ eventName, expected, results }) {
  const failures = [];
  const requireSuccess = (lane) => {
    if (results[lane] !== 'success') {
      failures.push(`${lane} was required but concluded: ${results[lane]}`);
    }
  };
  requireSuccess('changes');
  requireSuccess('secret_scan');
  if (expected.checks) {
    requireSuccess('quality_static');
    requireSuccess('quality_tests');
  }
  for (const lane of [
    'db_integration',
    'worker_integration',
    'migration_integration',
    'windows',
    'runtime_pressure',
    'e2e',
    'agent_eval',
    'desktop',
  ]) {
    if (expected[lane]) {
      requireSuccess(lane === 'desktop' ? 'desktop_build' : lane);
    }
  }
  if (eventName === 'pull_request' && expected.dependency_review) {
    requireSuccess('dependency_review');
  }
  if (expected.release_evidence) {
    requireSuccess('release_evidence');
  }
  return failures;
}

export function expectedResultsFromEnvironment(environment = process.env) {
  const boolean = (name) => environment[name] === 'true';
  return {
    checks: boolean('CHECKS_EXPECTED'),
    db_integration: boolean('DB_INTEGRATION_EXPECTED'),
    worker_integration: boolean('WORKER_INTEGRATION_EXPECTED'),
    migration_integration: boolean('MIGRATION_INTEGRATION_EXPECTED'),
    windows: boolean('WINDOWS_EXPECTED'),
    runtime_pressure: boolean('RUNTIME_PRESSURE_EXPECTED'),
    e2e: boolean('E2E_EXPECTED'),
    agent_eval: boolean('AGENT_EVAL_EXPECTED'),
    dependency_review: boolean('DEPENDENCY_REVIEW_EXPECTED'),
    release_evidence: boolean('RELEASE_EVIDENCE_EXPECTED'),
    desktop: boolean('DESKTOP_EXPECTED'),
  };
}

export function laneResultsFromEnvironment(environment = process.env) {
  return {
    changes: environment.CHANGES_RESULT,
    secret_scan: environment.SECRET_SCAN_RESULT,
    dependency_review: environment.DEPENDENCY_REVIEW_RESULT,
    quality_static: environment.QUALITY_STATIC_RESULT,
    quality_tests: environment.QUALITY_TESTS_RESULT,
    db_integration: environment.DB_INTEGRATION_RESULT,
    worker_integration: environment.WORKER_INTEGRATION_RESULT,
    migration_integration: environment.MIGRATION_INTEGRATION_RESULT,
    windows: environment.WINDOWS_RESULT,
    runtime_pressure: environment.RUNTIME_PRESSURE_RESULT,
    e2e: environment.E2E_RESULT,
    agent_eval: environment.AGENT_EVAL_RESULT,
    release_evidence: environment.RELEASE_EVIDENCE_RESULT,
    desktop_build: environment.DESKTOP_BUILD_RESULT,
  };
}

function verifyResultsFromEnvironment() {
  const failures = requiredResultFailures({
    eventName: process.env.EVENT_NAME,
    expected: expectedResultsFromEnvironment(),
    results: laneResultsFromEnvironment(),
  });
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('All required CI lanes succeeded.');
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

export function comparisonRange(base, head) {
  if (
    !/^[0-9a-f]{40}$/i.test(base ?? '') ||
    /^0+$/.test(base) ||
    !/^[0-9a-f]{40}$/i.test(head ?? '')
  ) {
    throw new Error('missing or invalid comparison SHA');
  }
  return `${base}...${head}`;
}

function changedPaths(base, head) {
  return execFileSync(
    'git',
    ['diff', '--name-only', '-z', comparisonRange(base, head)],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(Boolean);
}

function main() {
  if (process.argv.includes('--verify-results')) {
    verifyResultsFromEnvironment();
    return;
  }
  const eventName =
    argument('--event') ?? process.env.GITHUB_EVENT_NAME ?? 'pull_request';
  let result;
  try {
    if (eventName === 'schedule' || eventName === 'workflow_dispatch') {
      result = classifyChangedPaths([], { eventName });
      console.log(`${eventName} explicitly selects the full CI matrix.`);
    } else {
      const paths = changedPaths(argument('--base'), argument('--head'));
      result = classifyChangedPaths(paths, { eventName });
      console.log(`Changed paths: ${paths.join(', ') || '(none; fail-open)'}`);
    }
  } catch (error) {
    console.warn(`CI impact classification failed open: ${error.message}`);
    result = { ...ALL };
  }
  const output = `${Object.entries(result)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
  const githubOutput = argument('--github-output');
  if (githubOutput) appendFileSync(githubOutput, output);
  else process.stdout.write(output);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
