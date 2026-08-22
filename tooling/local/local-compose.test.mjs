import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { composeArgs, composeFile, repoRoot } from './local-compose.mjs';

test('local Compose commands use the reviewed file and repository project directory', () => {
  assert.equal(existsSync(composeFile), true);
  assert.deepEqual(composeArgs('config'), [
    'compose',
    '--project-directory',
    repoRoot,
    '-f',
    composeFile,
    'config',
  ]);
});
