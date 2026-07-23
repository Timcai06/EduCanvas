import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const launcher = readFileSync('start-educanvas.ps1', 'utf8');
const orchestrator = readFileSync('tooling/local-orchestrator.mjs', 'utf8');

describe('Windows startup boundary', () => {
  it('keeps Windows-only startup concerns explicit and parameterized', () => {
    // The launcher owns Docker, migration caching, port checks, and logs;
    // the actual Web/Gateway/Worker process remains the shared dev command.
    assert.match(launcher, /\[switch\]\$SkipMigrate/);
    assert.match(launcher, /\[switch\]\$NoOpen/);
    assert.match(launcher, /\[int\]\$Port = 3101/);
    assert.match(launcher, /Get-NetTCPConnection/);
    assert.match(launcher, /pnpm dev:core/);
    assert.match(launcher, /pnpm db:migrate/);
    assert.match(launcher, /MigrationStatePath/);
    assert.match(launcher, /LogPath/);
  });

  it('does not let -SkipMigrate skip starting PostgreSQL', () => {
    const ensureIndex = launcher.lastIndexOf('\nEnsure-DockerDb');
    const migrateBranchIndex = launcher.indexOf('if (-not $SkipMigrate)');

    assert.ok(ensureIndex >= 0, 'launcher must start the local database');
    assert.ok(
      migrateBranchIndex > ensureIndex,
      '-SkipMigrate should only affect Run-Migrations after the database is ready',
    );
  });

  it('normalizes common quoted .env values without evaluating them', () => {
    assert.match(launcher, /\$Value = \$matches\[2\]\.Trim\(\)/);
    assert.match(launcher, /\$Value\.StartsWith\('"'\)/);
    assert.match(launcher, /\$Value\.StartsWith\("'"\)/);
    assert.match(
      launcher,
      /\$Value = \$Value\.Substring\(1, \$Value\.Length - 2\)/,
    );
    assert.match(
      launcher,
      /SetEnvironmentVariable\(\$Name, \$Value, 'Process'\)/,
    );
    assert.doesNotMatch(launcher, /Invoke-Expression/);
  });

  it('lets the shared orchestrator launch pnpm on Windows', () => {
    assert.match(
      orchestrator,
      /shell: process\.platform === 'win32' && command === 'pnpm'/,
    );
  });
});
