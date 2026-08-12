import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = (path) => readFileSync(path, 'utf8');

describe('local configuration contract', () => {
  it('keeps the documented database URL aligned with the Compose host port', () => {
    const compose = source('docker-compose.yml');
    const env = source('.env.example');
    const drizzle = source('packages/db/drizzle.config.ts');
    const hostPort = compose.match(/- ['"](\d+):5432['"]/)?.[1];
    assert.equal(hostPort, '5434');
    assert.match(env, new RegExp(`localhost:${hostPort}/educanvas`));
    assert.match(drizzle, new RegExp(`localhost:${hostPort}/educanvas`));
  });

  it('uses .nvmrc as the README and package engine authority', () => {
    const version = source('.nvmrc').trim().replace(/^v/, '');
    const major = Number(version.split('.')[0]);
    const rootPackage = JSON.parse(source('package.json'));
    assert.equal(rootPackage.engines.node, `>=${version} <${major + 1}`);
    assert.match(source('README.md'), new RegExp(`Node\\.js ${version}`));
  });

  it('lets env-check decide whether an optional Provider is complete', () => {
    const makefile = source('Makefile');
    assert.match(makefile, /pnpm env:check \.env/);
    assert.doesNotMatch(makefile, /MODEL_GATEWAY_API_KEY 未设置/);
    assert.match(makefile, /node tooling\/node-runtime-check\.mjs/);
  });

  it('declares the existing Desktop output without changing its build command', () => {
    const turbo = JSON.parse(source('turbo.json'));
    assert.deepEqual(turbo.tasks['@educanvas/desktop#build'].outputs, [
      'out/**',
    ]);
    const desktop = JSON.parse(source('apps/desktop/package.json'));
    assert.equal(desktop.scripts.build, 'electron-vite build');
  });
});
