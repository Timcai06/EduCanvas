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
  'dependency_review',
  'release_evidence',
  'desktop',
];
const ALL = Object.fromEntries(LANES.map((lane) => [lane, true]));
const NONE = Object.fromEntries(LANES.map((lane) => [lane, false]));
const DOC_ONLY =
  /^docs\/.*\.md$|^(?:README|AGENTS|CLAUDE)\.md$|^(?:apps|packages|tooling)\/[^/]+\/README\.md$|^\.vscode\/(?:settings|extensions)\.json$|^\.github\/CODEOWNERS$/;
const DEPENDENCY =
  /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$|^\.github\/workflows\//;
const RELEASE_EVIDENCE =
  /^docs\/06-quality\/releases\/|^docs\/06-quality\/08-|^tooling\/quality\/(?:validate-evidence|migration-records)\.mjs$|^packages\/db\/drizzle\//;

function matchesAny(paths, patterns) {
  return paths.some((path) => patterns.some((pattern) => pattern.test(path)));
}

export function classifyChangedPaths(
  paths,
  { eventName = 'pull_request' } = {},
) {
  if (eventName === 'workflow_dispatch') return { ...ALL };
  if (paths.length === 0) return { ...ALL };
  const knownRoots = new Set([
    '.github',
    '.vscode',
    'apps',
    'docs',
    'packages',
    'tests',
    'tooling',
  ]);
  const hasUnknownLocation = paths.some((path) => {
    const [root] = path.split('/');
    return path.includes('/')
      ? !knownRoots.has(root)
      : ![
          '.editorconfig',
          '.env.example',
          '.gitattributes',
          '.gitignore',
          '.gitleaksignore',
          '.nvmrc',
          '.prettierignore',
          '.prettierrc',
          'AGENTS.md',
          'CLAUDE.md',
          'Makefile',
          'README.md',
          'Start EduCanvas.cmd',
          'Stop EduCanvas.cmd',
          'docker-compose.yml',
          'package.json',
          'playwright.config.ts',
          'playwright.pr.config.ts',
          'playwright.runtime-composition.config.ts',
          'playwright.runtime.config.ts',
          'playwright.ui.config.ts',
          'pnpm-lock.yaml',
          'pnpm-workspace.yaml',
          'start-educanvas.ps1',
          'stop-educanvas.ps1',
          'tsconfig.base.json',
          'turbo.json',
        ].includes(path);
  });
  if (hasUnknownLocation) return { ...ALL };
  const releaseEvidenceAffected = matchesAny(paths, [RELEASE_EVIDENCE]);
  if (!releaseEvidenceAffected && paths.every((path) => DOC_ONLY.test(path)))
    return { ...NONE };
  if (paths.some((path) => DEPENDENCY.test(path))) return { ...ALL };

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
    /^docker-compose\.yml$/,
  ]);
  const migrationAffected = matchesAny(paths, [
    /^packages\/db\/drizzle\//,
    /^packages\/db\/src\/schema\//,
    /^packages\/db\/src\/migrations\.integration\.test\.ts$/,
    /^tooling\/quality\/migration-(?:governance|integration|records)\.mjs$/,
    /^tooling\/migration-(?:governance|records)\.test\.mjs$/,
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
    /^(?:start|stop)-educanvas\.ps1$/,
    /^\.env\.example$/,
    /^apps\/node\//,
    /^packages\/(?:node-host|node-runtime)\//,
    /^tooling\/(?:env-check|local-|web-dev|windows-|workspace-env)/,
  ]);
  result.runtime_pressure = matchesAny(paths, [
    /^apps\/web-runtime\//,
    /^packages\/(?:canvas-protocol|experiment-runtime|gateway-runtime)\//,
    /^apps\/web\/(?:app\/api\/runtime|features\/canvas|server\/runtime)/,
    /^playwright\.runtime(?:-composition)?\.config\.ts$/,
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
    /^playwright\..*\.config\.ts$/,
    /^playwright\.config\.ts$/,
    /^docker-compose\.yml$/,
    /^tooling\/(?:e2e-|quality\/bundle-size)/,
  ];
  result.e2e = paths.some(
    (path) =>
      !NON_BROWSER_ONLY.test(path) &&
      browserPatterns.some((pattern) => pattern.test(path)),
  );
  result.dependency_review = false;
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
  for (const lane of [
    'checks',
    'db_integration',
    'worker_integration',
    'migration_integration',
    'windows',
    'runtime_pressure',
    'e2e',
    'desktop',
  ]) {
    if (expected[lane]) {
      requireSuccess(
        lane === 'checks'
          ? 'quality'
          : lane === 'desktop'
            ? 'desktop_build'
            : lane,
      );
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

function verifyResultsFromEnvironment() {
  const boolean = (name) => process.env[name] === 'true';
  const failures = requiredResultFailures({
    eventName: process.env.EVENT_NAME,
    expected: {
      checks: boolean('CHECKS_EXPECTED'),
      db_integration: boolean('DB_INTEGRATION_EXPECTED'),
      worker_integration: boolean('WORKER_INTEGRATION_EXPECTED'),
      migration_integration: boolean('MIGRATION_INTEGRATION_EXPECTED'),
      windows: boolean('WINDOWS_EXPECTED'),
      runtime_pressure: boolean('RUNTIME_PRESSURE_EXPECTED'),
      e2e: boolean('E2E_EXPECTED'),
      dependency_review: boolean('DEPENDENCY_REVIEW_EXPECTED'),
      release_evidence: boolean('RELEASE_EVIDENCE_EXPECTED'),
      desktop: boolean('DESKTOP_EXPECTED'),
    },
    results: {
      changes: process.env.CHANGES_RESULT,
      secret_scan: process.env.SECRET_SCAN_RESULT,
      dependency_review: process.env.DEPENDENCY_REVIEW_RESULT,
      quality: process.env.QUALITY_RESULT,
      db_integration: process.env.DB_INTEGRATION_RESULT,
      worker_integration: process.env.WORKER_INTEGRATION_RESULT,
      migration_integration: process.env.MIGRATION_INTEGRATION_RESULT,
      windows: process.env.WINDOWS_RESULT,
      runtime_pressure: process.env.RUNTIME_PRESSURE_RESULT,
      e2e: process.env.E2E_RESULT,
      release_evidence: process.env.RELEASE_EVIDENCE_RESULT,
      desktop_build: process.env.DESKTOP_BUILD_RESULT,
    },
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
    const paths = changedPaths(argument('--base'), argument('--head'));
    result = classifyChangedPaths(paths, { eventName });
    console.log(`Changed paths: ${paths.join(', ') || '(none; fail-open)'}`);
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
