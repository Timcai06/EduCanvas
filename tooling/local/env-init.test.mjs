import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { initializeEnvironment } from './env-init.mjs';

test('env:init copies the reviewed template without overwriting existing configuration', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'educanvas-env-init-'));
  const templatePath = path.join(root, 'local.env.example');
  const targetPath = path.join(root, '.env');
  try {
    await writeFile(templatePath, 'DATABASE_URL=reviewed\n');
    assert.equal(
      initializeEnvironment({ templatePath, targetPath }),
      targetPath,
    );
    assert.equal(readFileSync(targetPath, 'utf8'), 'DATABASE_URL=reviewed\n');
    assert.throws(
      () => initializeEnvironment({ templatePath, targetPath }),
      /拒绝覆盖已有环境文件/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
