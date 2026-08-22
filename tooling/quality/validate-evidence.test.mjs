import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';

const validator = resolve('tooling/quality/validate-evidence.mjs');
const directories = [];
const SHA = 'a'.repeat(40);
const timestamp = '2026-08-11T00:00:00.000Z';
const migrationVersion = readdirSync(resolve('packages/db/drizzle')).filter(
  (name) => name.endsWith('.sql'),
).length;

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'educanvas-evidence-'));
  directories.push(directory);
  writeFileSync(join(directory, 'evidence.json'), '{}\n');
  return directory;
}

function gate(status) {
  return { status, timestamp: status === 'passed' ? timestamp : '' };
}

function manifest(status = 'pending') {
  const item = gate(status === 'passed' ? 'passed' : 'pending');
  return {
    release: 'fixture',
    version: '0.1.0-rc1',
    status,
    baseline: { sha: SHA, branch: 'main', timestamp },
    migration: {
      version: migrationVersion,
      fresh: { ...item },
      upgrade: { ...item },
    },
    supply_chain: {
      actions_pinned: { ...item },
      dependency_review: { ...item },
      container_digest: { ...item },
      migration_records: { ...item },
    },
    gates: Object.fromEntries(
      [
        'lint',
        'typecheck',
        'unit',
        'db-integration',
        'worker-integration',
        'build',
        'e2e',
        'security',
        'contract',
        'provider-smoke',
        'release-evidence',
        'eval',
      ].map((name) => [name, { ...item }]),
    ),
    eval: {
      retrieval: { ...item, baseline: { recallAt10: 1 } },
      'tool-artifact': { ...item, baseline: { criticalPassRate: 1 } },
      'teaching-safety': { ...item, baseline: { criticalPassRate: 1 } },
    },
    budget: {
      cost: {
        status: item.status,
        actual: item.status === 'passed' ? 1 : 0,
        limit: 2,
      },
      latency: {
        status: item.status,
        p95_actual_ms: item.status === 'passed' ? 100 : 0,
        p95_limit_ms: 200,
      },
      error_rate: {
        status: item.status,
        actual: item.status === 'passed' ? 0.01 : 0,
        limit: 0.02,
      },
    },
    signoffs: {
      security: { signed: status === 'passed', by: 'reviewer', timestamp },
      product: { signed: status === 'passed', by: 'reviewer', timestamp },
      engineering: { signed: status === 'passed', by: 'reviewer', timestamp },
    },
    evidence: { fixture: 'evidence.json' },
  };
}

function run(mode, value, sha = SHA) {
  const directory = temporaryDirectory();
  const path = join(directory, 'manifest.json');
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return spawnSync(
    process.execPath,
    [validator, '--mode', mode, '--sha', sha, path],
    { encoding: 'utf8' },
  );
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('release evidence modes', () => {
  it('accepts a structurally consistent pending draft', () => {
    const result = run('draft', manifest());
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Draft evidence structure is valid/);
  });

  it('rejects the same pending manifest as release-ready', () => {
    const result = run('release', manifest());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /manifest\.status=passed/);
    assert.match(result.stderr, /gate lint 必须 passed/);
  });

  it('accepts terminal evidence only when its baseline binds to the target SHA', () => {
    const ready = manifest('passed');
    const success = run('release', ready);
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /Release readiness verified/);

    const mismatch = run('release', ready, 'b'.repeat(40));
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /baseline\.sha.*目标 SHA/);
  });

  it('rejects zero measurements that claim to have passed', () => {
    const ready = manifest('passed');
    ready.budget.cost.actual = 0;
    const result = run('release', ready);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /0 表示没测量/);
  });

  it('rejects an empty or all-zero evaluation baseline in release mode', () => {
    const ready = manifest('passed');
    ready.eval.retrieval.baseline = { recallAt10: 0 };
    const result = run('release', ready);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /eval retrieval 缺少非零 baseline 测量/);
  });
});
