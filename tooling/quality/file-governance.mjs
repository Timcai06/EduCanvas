#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const baselinePath = resolve(
  repoRoot,
  'tooling/quality/file-size-baseline.json',
);

export const ROOT_FILE_POLICY = new Map([
  ['.editorconfig', 'editor discovery'],
  ['.gitattributes', 'Git behavior'],
  ['.gitignore', 'Git ignore policy'],
  ['.gitleaksignore', 'secret scanning discovery'],
  ['.nvmrc', 'Node version discovery'],
  ['AGENTS.md', 'Codex instruction discovery'],
  ['CLAUDE.md', 'Claude instruction discovery'],
  ['Makefile', 'make command discovery'],
  ['README.md', 'repository documentation entrypoint'],
  ['Start EduCanvas.cmd', 'Windows double-click compatibility'],
  ['Stop EduCanvas.cmd', 'Windows double-click compatibility'],
  ['package.json', 'Node workspace entrypoint'],
  ['pnpm-lock.yaml', 'dependency lock'],
  ['pnpm-workspace.yaml', 'pnpm workspace discovery'],
  ['skills-lock.json', 'agent skill lock discovery'],
  ['tsconfig.base.json', 'workspace TypeScript base'],
  ['turbo.json', 'Turborepo discovery'],
]);
const TOP_LEVEL_DIRECTORIES = new Set([
  '.agents',
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
const SHARED_VSCODE_FILES = new Set([
  '.vscode/extensions.json',
  '.vscode/settings.json',
]);
const GENERATED_SEGMENTS = new Set([
  '.next',
  '.pnpm-store',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'output',
]);
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
]);
const TEST_PATTERN =
  /(?:^|\/)(?:test-fixtures?|__tests__)(?:\/|$)|(?:^|\/)test-[^/]+\.[^.]+$|\.(?:integration\.)?(?:spec|test)\.[^.]+$|\.fixture\.[^.]+$/;
const DUPLICATE_EXTENSION_PATTERN = /\.(md|json|ya?ml|tsx?|jsx?|mjs|cjs)\.\1$/i;

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
}

function businessDomain(path) {
  const parts = path.split('/');
  if (parts[0] === 'apps' || parts[0] === 'packages')
    return parts[1] ?? 'unknown';
  if (parts[0] === 'docs') return `docs:${parts[1] ?? 'root'}`;
  if (parts[0] === 'tooling') return 'developer-tooling';
  if (parts[0] === 'tests') return 'cross-system';
  return 'repository';
}

function technicalRole(path) {
  if (TEST_PATTERN.test(path)) return 'test';
  if (/(?:^|\/)README\.md$|\.md$/.test(path)) return 'documentation';
  if (
    /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*\.json|turbo\.json)$|(?:^|\/)(?:package|tsconfig|vitest|playwright)[^/]*\.(?:json|ts)$/.test(
      path,
    )
  )
    return 'configuration';
  if (/\.sql$|(?:^|\/)drizzle\/meta\//.test(path)) return 'migration';
  if (/(?:^|\/)src\//.test(path)) return 'source';
  if (/(?:^|\/)tooling\//.test(path)) return 'tool';
  return 'support';
}

function lifecycle(path) {
  if (
    path.startsWith('docs/archive/') ||
    path.startsWith('docs/plan/completed/') ||
    path.startsWith('docs/00-overview/snapshots/')
  )
    return 'archived';
  if (/\.sql$|(?:^|\/)drizzle\/meta\//.test(path)) return 'generated-record';
  if (TEST_PATTERN.test(path)) return 'verification';
  if (/(?:^|\/)(?:evidence|fixtures?)\//.test(path))
    return 'evidence-or-fixture';
  if (path.startsWith('docs/')) return 'maintained-documentation';
  return 'maintained';
}

export function classifyTrackedPath(path) {
  const parts = path.split('/');
  return {
    path,
    location: parts.length === 1 ? 'repository-root' : parts[0],
    domain: businessDomain(path),
    role: technicalRole(path),
    lifecycle: lifecycle(path),
  };
}

export function pathViolations(path) {
  const violations = [];
  const parts = path.split('/');
  if (parts.length === 1) {
    if (!ROOT_FILE_POLICY.has(path))
      violations.push('unclassified repository-root file');
  } else if (!TOP_LEVEL_DIRECTORIES.has(parts[0])) {
    violations.push(`unclassified top-level directory: ${parts[0]}`);
  }
  if (/^tooling\/[^/]+$/.test(path)) {
    violations.push('loose tooling-root file');
  }
  if (/^docs\/[^/]+$/.test(path) && path !== 'docs/README.md') {
    violations.push('loose docs-root file');
  }
  if (path.startsWith('.vscode/') && !SHARED_VSCODE_FILES.has(path)) {
    violations.push('personal VS Code state must not be tracked');
  }
  if (parts.some((part) => GENERATED_SEGMENTS.has(part))) {
    violations.push('generated/cache/output directory must not be tracked');
  }
  if (DUPLICATE_EXTENSION_PATTERN.test(path)) {
    violations.push('duplicate filename extension');
  }
  return violations;
}

function isGovernedSource(path) {
  if (!SOURCE_EXTENSIONS.has(extname(path)) || TEST_PATTERN.test(path))
    return false;
  if (path.includes('/drizzle/') || path.endsWith('.d.ts')) return false;
  return (
    path.startsWith('apps/') ||
    path.startsWith('packages/') ||
    path.startsWith('tooling/')
  );
}

function lineCount(path) {
  const text = readFileSync(resolve(repoRoot, path), 'utf8');
  return text === '' ? 0 : text.split(/\r?\n/).length;
}

function currentLargeSources(files) {
  return Object.fromEntries(
    files
      .filter(isGovernedSource)
      .map((path) => [path, lineCount(path)])
      .filter(([, lines]) => lines >= 400),
  );
}

function writeBaseline(files) {
  const reasonIndex = process.argv.indexOf('--bootstrap-reason');
  const reason = reasonIndex >= 0 ? process.argv[reasonIndex + 1]?.trim() : '';
  if (!reason) {
    throw new Error(
      '--write-size-baseline requires --bootstrap-reason <maintenance rationale>',
    );
  }
  const largeFiles = currentLargeSources(files);
  let issueSequence = 1;
  const payload = {
    policy:
      'Review at 400 lines; split before 600 unless a named plan owns the debt.',
    threshold: 400,
    files: Object.entries(largeFiles)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, acceptedLines]) => ({
        file,
        owner: ownerForFile(file),
        reason,
        targetLines: 400,
        issue: `internal:ARCH-DEBT-${String(issueSequence++).padStart(4, '0')}`,
        expiry: acceptedLines >= 600 ? '2026-11-30' : '2027-02-28',
        acceptedLines,
      })),
  };
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `Wrote ${Object.keys(largeFiles).length} governed source baselines.`,
  );
}

function sizeViolations(files) {
  if (!existsSync(baselinePath))
    return ['missing tooling/quality/file-size-baseline.json'];
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const current = currentLargeSources(files);
  return largeSourceBaselineViolations(current, baseline.files);
}

export function largeSourceBaselineViolations(current, acceptedFiles) {
  const violations = [];
  if (!Array.isArray(acceptedFiles)) {
    return ['file-size baseline files must be an accountable entry array'];
  }
  const entries = new Map();
  const issues = new Set();
  const today = new Date().toISOString().slice(0, 10);
  for (const entry of acceptedFiles) {
    const label = entry?.file ?? '<missing file>';
    for (const field of [
      'file',
      'owner',
      'reason',
      'targetLines',
      'issue',
      'expiry',
      'acceptedLines',
    ]) {
      if (entry?.[field] === undefined || entry[field] === '') {
        violations.push(`${label}: baseline entry is missing ${field}`);
      }
    }
    if (
      !['agent-runtime', 'gateway', 'data', 'developer-productivity'].includes(
        entry?.owner,
      )
    ) {
      violations.push(
        `${label}: invalid logical owner ${String(entry?.owner)}`,
      );
    }
    if (entry?.targetLines !== 400) {
      violations.push(`${label}: targetLines must remain 400`);
    }
    if (!/^internal:ARCH-DEBT-\d{4}$/.test(entry?.issue ?? '')) {
      violations.push(`${label}: issue must be internal:ARCH-DEBT-####`);
    } else if (issues.has(entry.issue)) {
      violations.push(`${label}: duplicate debt issue ${entry.issue}`);
    }
    issues.add(entry?.issue);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(entry?.expiry ?? '') ||
      entry.expiry < today
    ) {
      violations.push(`${label}: debt expiry is invalid or expired`);
    }
    if (entries.has(label))
      violations.push(`${label}: duplicate baseline entry`);
    entries.set(label, entry);
  }
  for (const [path, lines] of Object.entries(current)) {
    const accepted = entries.get(path);
    if (accepted === undefined)
      violations.push(
        `${path}: new ${lines}-line source requires split or an explicit baseline decision`,
      );
    else if (lines > accepted.acceptedLines)
      violations.push(
        `${path}: grew from ${accepted.acceptedLines} to ${lines} lines`,
      );
  }
  for (const [path, entry] of entries) {
    const lines = current[path];
    if (lines === undefined) {
      violations.push(
        `${path}: baseline is stale because the file is below 400 lines or absent`,
      );
    } else if (lines < entry.targetLines) {
      violations.push(
        `${path}: baseline is stale because ${lines} is below target ${entry.targetLines}`,
      );
    }
  }
  return violations;
}

function ownerForFile(file) {
  if (
    file.startsWith('packages/db/') ||
    file.startsWith('packages/asset-processing/')
  )
    return 'data';
  if (
    file.startsWith('packages/agent-') ||
    file.startsWith('packages/teaching-') ||
    file.startsWith('apps/worker/')
  )
    return 'agent-runtime';
  if (
    file.startsWith('apps/web/') ||
    file.startsWith('apps/gateway/') ||
    file.startsWith('apps/desktop/') ||
    file.startsWith('apps/tui/') ||
    file.startsWith('packages/gateway-')
  )
    return 'gateway';
  return 'developer-productivity';
}

export function auditTrackedFiles(files) {
  const classifications = files.map(classifyTrackedPath);
  const violations = classifications.flatMap(({ path }) =>
    pathViolations(path).map((message) => `${path}: ${message}`),
  );
  return { classifications, violations };
}

function main() {
  const files = trackedFiles();
  if (process.argv.includes('--write-size-baseline')) {
    writeBaseline(files);
    return;
  }
  const { classifications, violations } = auditTrackedFiles(files);
  violations.push(...sizeViolations(files));
  const counts = classifications.reduce((summary, item) => {
    summary[item.lifecycle] = (summary[item.lifecycle] ?? 0) + 1;
    return summary;
  }, {});
  console.log(
    `Classified ${files.length} tracked files across location, domain, role, and lifecycle.`,
  );
  console.log(`Lifecycle summary: ${JSON.stringify(counts)}`);
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
