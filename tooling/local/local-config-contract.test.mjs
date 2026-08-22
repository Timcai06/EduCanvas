import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = (path) => readFileSync(path, 'utf8');
const makeSource = () =>
  [
    'Makefile',
    'tooling/make/runtime.mk',
    'tooling/make/database.mk',
    'tooling/make/quality.mk',
  ]
    .map(source)
    .join('\n');

describe('local configuration contract', () => {
  it('keeps the documented database URL aligned with the Compose host port', () => {
    const compose = source('infrastructure/compose/local.yml');
    const env = source('config/env/local.env.example');
    const drizzle = source('packages/db/drizzle.config.ts');
    const hostPort = compose.match(
      /\$\{EDUCANVAS_POSTGRES_PORT:-(\d+)\}:5432/,
    )?.[1];
    assert.equal(hostPort, '5434');
    assert.doesNotMatch(compose, /container_name:/);
    assert.match(
      compose,
      /127\.0\.0\.1:\$\{EDUCANVAS_POSTGRES_PORT:-5434\}:5432/,
    );
    assert.match(env, new RegExp(`127\\.0\\.0\\.1:${hostPort}/educanvas`));
    assert.match(drizzle, new RegExp(`127\\.0\\.0\\.1:${hostPort}/educanvas`));
    const canonicalUrl = env.match(/^DATABASE_URL=(.+)$/m)?.[1];
    assert.ok(canonicalUrl);
    assert.ok(
      source('docs/04-data/04-D00-数据架构基线.md').includes(canonicalUrl),
    );
  });

  it('isolates Compose projects while routing shared test URLs through one host-port override', () => {
    const makefile = makeSource();
    assert.match(makefile, /EDUCANVAS_POSTGRES_PORT \?= 5434/);
    assert.match(makefile, /export EDUCANVAS_POSTGRES_PORT/);
    assert.match(
      source('config/env/local.env.example'),
      /EDUCANVAS_POSTGRES_PORT=5435 DATABASE_URL=/,
    );
    assert.match(
      makefile,
      /TEST_DATABASE_URL \?=.*\$\(EDUCANVAS_POSTGRES_PORT\)\/educanvas_integration/,
    );
    assert.match(
      makefile,
      /E2E_DATABASE_URL \?=.*\$\(EDUCANVAS_POSTGRES_PORT\)\/educanvas_e2e/,
    );
  });

  it('uses .nvmrc as the README and package engine authority', () => {
    const version = source('.nvmrc').trim().replace(/^v/, '');
    const rootPackage = JSON.parse(source('package.json'));
    assert.equal(rootPackage.engines.node, `>=${version}`);
    assert.match(source('README.md'), new RegExp(`Node\\.js ${version}`));
    const collaboration = source('docs/08-collaboration/03-团队协作指南.md');
    assert.match(collaboration, new RegExp(`Node\\.js ${version}`));
    assert.doesNotMatch(collaboration, /Node\.js 22/);
  });

  it('lets env-check decide whether an optional Provider is complete', () => {
    const makefile = makeSource();
    assert.match(makefile, /pnpm env:check \.env/);
    assert.doesNotMatch(makefile, /MODEL_GATEWAY_API_KEY 未设置/);
    assert.match(makefile, /node tooling\/quality\/node-runtime-check\.mjs/);
    const collaboration = source('docs/08-collaboration/03-团队协作指南.md');
    assert.match(collaboration, /Provider 可选/);
    assert.match(collaboration, /pnpm env:check/);
    assert.doesNotMatch(collaboration, /填入自己的API Key/);
  });

  it('declares the existing Desktop output without changing its build command', () => {
    const turbo = JSON.parse(source('turbo.json'));
    assert.deepEqual(turbo.tasks['@educanvas/desktop#build'].outputs, [
      'out/**',
    ]);
    const desktop = JSON.parse(source('apps/desktop/package.json'));
    assert.equal(desktop.scripts.build, 'electron-vite build');
  });

  it('builds both production processes before starting the local E2E matrix', () => {
    const makefile = makeSource();
    const e2eRecipe = makefile.match(
      /\ne2e:[\s\S]*?(?=\n[^\t\n][^\n]*:|$)/,
    )?.[0];
    assert.ok(e2eRecipe);
    assert.match(e2eRecipe, /--filter @educanvas\/web build/);
    assert.match(e2eRecipe, /--filter @educanvas\/worker build/);
    assert.ok(
      e2eRecipe.indexOf('--filter @educanvas/web build') <
        e2eRecipe.indexOf('pnpm test:e2e'),
    );
    assert.ok(
      e2eRecipe.indexOf('--filter @educanvas/worker build') <
        e2eRecipe.indexOf('pnpm test:e2e'),
    );
  });

  it('pins Compose to the reviewed file while preserving the repository project directory', () => {
    const composeTool = source('tooling/local/local-compose.mjs');
    assert.match(composeTool, /'infrastructure'/);
    assert.match(composeTool, /'compose'/);
    assert.match(composeTool, /'local\.yml'/);
    assert.match(composeTool, /'--project-directory'/);
    assert.match(
      source('package.json'),
      /tooling\/local\/local-compose\.mjs up -d/,
    );
  });

  it('keeps the local Web default on 3000 across every first-party entrypoint', () => {
    const expectedOrigin = 'http://127.0.0.1:3000';
    assert.match(source('Makefile'), /PORT \?= 3000/);
    assert.match(source('README.md'), /localhost:3000/);
    assert.match(
      source('scripts/windows/start-educanvas.ps1'),
      /\$Port = 3000/,
    );
    assert.ok(source('config/env/local.env.example').includes(expectedOrigin));
    assert.ok(
      source('apps/desktop/src/main/index.ts').includes(expectedOrigin),
    );
    assert.ok(source('apps/tui/src/index.ts').includes(expectedOrigin));
    assert.ok(source('apps/gateway/src/config.ts').includes(expectedOrigin));
    assert.match(source('Makefile'), /PLAYWRIGHT_PORT \?= 3100/);
  });
});
