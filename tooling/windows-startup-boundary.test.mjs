import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const launcher = readFileSync('start-educanvas.ps1', 'utf8');
const orchestrator = readFileSync('tooling/local-orchestrator.mjs', 'utf8');

describe('Windows startup boundary', () => {
  it('delegates service ownership and readiness to the shared orchestrator', () => {
    assert.match(launcher, /pnpm' @\('db:up'\)/);
    assert.match(launcher, /pnpm' @\('db:migrate'\)/);
    assert.match(launcher, /local-orchestrator\.mjs', 'web'/);
    assert.doesNotMatch(launcher, /pnpm dev:core/);
    assert.doesNotMatch(launcher, /Invoke-WebRequest/);
  });

  it('lets the shared orchestrator launch pnpm on Windows', () => {
    assert.match(
      orchestrator,
      /shell: process\.platform === 'win32' && command === 'pnpm'/,
    );
  });
});
