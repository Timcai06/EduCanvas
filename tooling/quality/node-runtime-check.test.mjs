import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';

const temporaryDirectories = [];

async function fixture(version) {
  const root = await mkdtemp(path.join(tmpdir(), 'educanvas-node-runtime-'));
  temporaryDirectories.push(root);
  await writeFile(path.join(root, '.nvmrc'), `${version}\n`, 'utf8');
  return root;
}

function run(root) {
  return spawnSync(
    process.execPath,
    ['tooling/quality/node-runtime-check.mjs', root],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );
}

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('node-runtime-check', () => {
  it('accepts the active version as the declared floor', async () => {
    const result = run(await fixture(process.versions.node));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /satisfies \.nvmrc floor/);
  });

  it('rejects a different major', async () => {
    const activeMajor = Number(process.versions.node.split('.')[0]);
    const result = run(await fixture(`${activeMajor + 1}.0.0`));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is required/);
  });

  it('rejects an active runtime below the declared floor', async () => {
    const [major] = process.versions.node.split('.');
    const result = run(await fixture(`${major}.99.0`));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is required/);
  });

  it('rejects a malformed authority file', async () => {
    const result = run(await fixture('24'));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must contain an exact version/);
  });
});
