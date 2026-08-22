import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolveWebDevCommand } from './web-dev-command.mjs';

const launcher = readFileSync('scripts/windows/start-educanvas.ps1', 'utf8');
const startCommand = readFileSync('Start EduCanvas.cmd', 'utf8');
const stopCommand = readFileSync('Stop EduCanvas.cmd', 'utf8');
const serviceSpawn = readFileSync(
  'tooling/local/local-service-spawn.mjs',
  'utf8',
);

describe('Windows startup boundary', () => {
  it('uses the Webpack dev compiler for Windows-safe Unicode diagnostics', () => {
    assert.deepEqual(resolveWebDevCommand('win32'), {
      command: 'pnpm',
      args: ['exec', 'next', 'dev', '--webpack'],
      shell: true,
    });
  });

  it('keeps the default Turbopack compiler on non-Windows platforms', () => {
    assert.deepEqual(resolveWebDevCommand('darwin'), {
      command: 'pnpm',
      args: ['exec', 'next', 'dev'],
      shell: false,
    });
  });

  it('keeps the Windows launcher a thin wrapper around the shared orchestrator', () => {
    // 启动/数据库/迁移/日志逻辑不再复制在 PowerShell 里，统一委托 orchestrator。
    assert.match(launcher, /tooling\/local\/local-orchestrator\.mjs/);
    assert.match(launcher, /\[int\]\$Port = 3000/);
    assert.doesNotMatch(launcher, /docker compose up/);
    assert.doesNotMatch(launcher, /pnpm dev:core/);
    assert.doesNotMatch(launcher, /pnpm db:migrate/);
    assert.doesNotMatch(launcher, /MigrationStatePath/);
    assert.doesNotMatch(launcher, /Get-NetTCPConnection/);
    assert.doesNotMatch(launcher, /Invoke-Expression/);
    assert.match(launcher, /Join-Path \$PSScriptRoot '\.\.\\\.\.'/);
    assert.match(startCommand, /scripts\\windows\\start-educanvas\.ps1" %\*/);
  });

  it('stop launcher keeps -KeepDb semantics by delegating stop-core', () => {
    const stopLauncher = readFileSync(
      'scripts/windows/stop-educanvas.ps1',
      'utf8',
    );
    assert.match(stopLauncher, /local-orchestrator\.mjs/);
    assert.match(stopLauncher, /\$KeepDb/);
    assert.match(stopLauncher, /stop-core/);
    assert.match(stopLauncher, /stop/);
    assert.match(stopCommand, /scripts\\windows\\stop-educanvas\.ps1" %\*/);
  });

  it('lets the shared orchestrator launch pnpm on Windows', () => {
    assert.match(
      serviceSpawn,
      /process\.platform === 'win32' && this\.command === 'pnpm'/,
    );
  });
});
