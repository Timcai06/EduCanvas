#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  manifestDependencyViolations,
  repositorySources,
  sourceImportViolations,
} from './package-policy-imports.mjs';

export {
  manifestDependencyViolations,
  parseModuleSpecifiers,
  sourceImportViolations,
} from './package-policy-imports.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const defaultPolicyPath = resolve(
  repoRoot,
  'tooling/architecture/package-policy.json',
);

export const PACKAGE_KINDS = new Set([
  'app',
  'core',
  'runtime',
  'adapter',
  'protocol',
  'tooling',
]);
export const PACKAGE_DOMAINS = new Set([
  'agent',
  'gateway',
  'teaching',
  'canvas',
  'data',
  'platform',
]);
export const PACKAGE_OWNERS = new Set([
  'agent-runtime',
  'gateway',
  'data',
  'developer-productivity',
]);
export const KIND_DEPENDENCY_MATRIX = Object.freeze({
  app: ['app', 'core', 'runtime', 'adapter', 'protocol', 'tooling'],
  core: ['core', 'protocol'],
  runtime: ['core', 'runtime', 'protocol'],
  adapter: ['core', 'runtime', 'adapter', 'protocol'],
  protocol: ['core', 'protocol'],
  tooling: ['core', 'runtime', 'adapter', 'protocol', 'tooling'],
});

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sameStringSet(left, right) {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

export function discoverWorkspaces(root = repoRoot) {
  return ['apps', 'packages']
    .flatMap((group) => {
      const groupPath = resolve(root, group);
      return readdirSync(groupPath, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            existsSync(resolve(groupPath, entry.name, 'package.json')),
        )
        .map((entry) => {
          const path = `${group}/${entry.name}`;
          const manifest = readJson(resolve(root, path, 'package.json'));
          return { name: manifest.name, path, manifest };
        });
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function validateAllowlistEntries(policy, violations, today) {
  const referenced = new Set();
  for (const category of ['dependencies', 'entrypoints']) {
    const entries = policy.allowlist?.[category];
    if (!Array.isArray(entries)) {
      violations.push(`policy: allowlist.${category} must be an array`);
      continue;
    }
    for (const [index, entry] of entries.entries()) {
      const label = `allowlist.${category}[${index}]`;
      for (const field of [
        'consumer',
        'target',
        'specifier',
        'reason',
        'issue',
        'expiry',
      ]) {
        if (typeof entry[field] !== 'string' || entry[field].trim() === '')
          violations.push(`${label}: missing ${field}`);
      }
      if (
        typeof entry.issue === 'string' &&
        !/^(?:internal:ARCH-DEBT-\d{4}|https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+)$/.test(
          entry.issue,
        )
      )
        violations.push(
          `${label}: issue must be an internal debt id or GitHub issue URL`,
        );
      if (
        typeof entry.expiry === 'string' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expiry) || entry.expiry < today)
      )
        violations.push(
          `${label}: expiry is invalid or expired (${entry.expiry})`,
        );
      const key = `${entry.consumer}\0${entry.target}\0${entry.specifier}`;
      if (referenced.has(key))
        violations.push(`${label}: duplicate allowlist scope`);
      referenced.add(key);
    }
  }
}

export function validatePackageRegistry(policy, workspaces, options = {}) {
  const violations = [];
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  if (policy.schemaVersion !== 1)
    violations.push('policy: schemaVersion must equal 1');
  if (!Array.isArray(policy.packages)) {
    return ['policy: packages must be an array'];
  }
  const byName = new Map();
  const byPath = new Map();
  for (const [index, entry] of policy.packages.entries()) {
    const label = `packages[${index}]`;
    if (byName.has(entry.name))
      violations.push(`${label}: duplicate name ${entry.name}`);
    if (byPath.has(entry.path))
      violations.push(`${label}: duplicate path ${entry.path}`);
    byName.set(entry.name, entry);
    byPath.set(entry.path, entry);
    if (!PACKAGE_KINDS.has(entry.kind))
      violations.push(`${label}: invalid kind ${entry.kind}`);
    if (!PACKAGE_DOMAINS.has(entry.domain))
      violations.push(`${label}: invalid domain ${entry.domain}`);
    if (!PACKAGE_OWNERS.has(entry.owner))
      violations.push(`${label}: invalid owner ${entry.owner}`);
    if (!Array.isArray(entry.publicEntrypoints))
      violations.push(`${label}: publicEntrypoints must be an array`);
    if (!Array.isArray(entry.allowedDependencyKinds))
      violations.push(`${label}: allowedDependencyKinds must be an array`);
    else if (
      PACKAGE_KINDS.has(entry.kind) &&
      !sameStringSet(
        entry.allowedDependencyKinds,
        KIND_DEPENDENCY_MATRIX[entry.kind],
      )
    )
      violations.push(
        `${label}: allowedDependencyKinds must match the ${entry.kind} dependency matrix`,
      );
    if (!Array.isArray(entry.forbiddenDependencies))
      violations.push(`${label}: forbiddenDependencies must be an array`);
  }
  for (const workspace of workspaces) {
    const entry = byPath.get(workspace.path);
    if (!entry) {
      violations.push(
        `${workspace.path}: workspace ${workspace.name ?? '(unnamed)'} is not registered`,
      );
      continue;
    }
    if (entry.name !== workspace.name)
      violations.push(
        `${workspace.path}: manifest name ${workspace.name} does not match policy ${entry.name}`,
      );
  }
  for (const entry of policy.packages) {
    const workspace = workspaces.find((item) => item.path === entry.path);
    if (!workspace)
      violations.push(`${entry.path}: policy entry has no workspace directory`);
  }
  validateAllowlistEntries(policy, violations, today);
  return violations;
}

export function auditPackagePolicy({
  root = repoRoot,
  policyPath = defaultPolicyPath,
  today,
} = {}) {
  const policy = readJson(policyPath);
  const workspaces = discoverWorkspaces(root);
  const violations = validatePackageRegistry(policy, workspaces, { today });
  if (violations.length === 0) {
    violations.push(...manifestDependencyViolations(policy, workspaces));
    violations.push(
      ...sourceImportViolations(
        policy,
        workspaces,
        repositorySources(root, workspaces),
      ),
    );
  }
  return {
    policy,
    workspaces,
    violations,
  };
}

function main() {
  const result = auditPackagePolicy();
  console.log(
    `Package policy registered ${result.policy.packages.length} of ${result.workspaces.length} workspaces.`,
  );
  if (result.violations.length > 0) {
    console.error(result.violations.join('\n'));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
