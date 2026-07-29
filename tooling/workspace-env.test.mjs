import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { loadWorkspaceEnvFiles } from './workspace-env.mjs';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createWorkspace() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'educanvas-env-'));
  temporaryDirectories.push(root);
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  const nested = path.join(root, 'apps', 'web');
  mkdirSync(nested, { recursive: true });
  return { root, nested };
}

test('loads .env from the workspace root when started in a nested directory', () => {
  const { root, nested } = createWorkspace();
  writeFileSync(
    path.join(root, '.env'),
    'DATABASE_URL="postgresql://localhost/educanvas"\nQUOTED="hello world"\n',
  );
  const environment = {};

  loadWorkspaceEnvFiles({ environment, startDirectory: nested });

  assert.equal(environment.DATABASE_URL, 'postgresql://localhost/educanvas');
  assert.equal(environment.QUOTED, 'hello world');
});

test('keeps explicit process values and treats file content as data', () => {
  const { root } = createWorkspace();
  writeFileSync(
    path.join(root, '.env'),
    'DATABASE_URL=from-file\nEMPTY=from-file\nSHARED=from-file\nLITERAL="$(not-a-command)"\n',
  );
  writeFileSync(
    path.join(root, '.env.local'),
    'DATABASE_URL=from-local\nSHARED=from-local\nLOCAL_ONLY=local\n',
  );
  const environment = {
    DATABASE_URL: 'from-shell',
    EMPTY: '',
  };

  loadWorkspaceEnvFiles({ environment, startDirectory: root });

  assert.equal(environment.DATABASE_URL, 'from-shell');
  assert.equal(environment.EMPTY, '');
  assert.equal(environment.SHARED, 'from-local');
  assert.equal(environment.LOCAL_ONLY, 'local');
  assert.equal(environment.LITERAL, '$(not-a-command)');
});

test('does nothing when the start directory is not inside a workspace', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'educanvas-no-root-'));
  temporaryDirectories.push(directory);
  const environment = {};

  loadWorkspaceEnvFiles({ environment, startDirectory: directory });

  assert.deepEqual(environment, {});
});
