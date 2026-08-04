import { describe, expect, it } from 'vitest';
import { buildDockerRunCommand, deriveContainerName } from './docker-command';
import { findEnvironment } from './environment-whitelist';

describe('docker command construction', () => {
  it('includes all required isolation flags', () => {
    const env = findEnvironment('cpu-python-3.11')!;
    const cmd = buildDockerRunCommand({
      runId: 'test-run',
      environment: env,
      codeDir: '/tmp/code',
      inputDirs: new Map([['data', '/tmp/input']]),
      outputDir: '/tmp/output',
      maxMemoryMiB: 512,
      maxProcesses: 32,
      maxDurationMs: 60_000,
    });

    expect(cmd).toContain('--network');
    expect(cmd).toContain('none');
    expect(cmd).toContain('--read-only');
    expect(cmd).toContain('--cap-drop');
    expect(cmd).toContain('ALL');
    expect(cmd).toContain('--security-opt');
    expect(cmd).toContain('no-new-privileges');
    expect(cmd).toContain('--init');
    expect(cmd).toContain('--rm');
    expect(cmd).toContain('--user');
    expect(cmd).toContain('1000:1000');
    expect(cmd).toContain('--memory');
    expect(cmd).toContain('512m');
    expect(cmd).toContain('--pids-limit');
    expect(cmd).toContain('32');
  });

  it('maxProcesses=7 generates --pids-limit 7', () => {
    const env = findEnvironment('cpu-python-3.11')!;
    const cmd = buildDockerRunCommand({
      runId: 'test-run',
      environment: env,
      codeDir: '/tmp/code',
      inputDirs: new Map(),
      outputDir: '/tmp/output',
      maxMemoryMiB: 256,
      maxProcesses: 7,
      maxDurationMs: 30_000,
    });

    const pidsIdx = cmd.indexOf('--pids-limit');
    expect(pidsIdx).toBeGreaterThan(-1);
    expect(cmd[pidsIdx + 1]).toBe('7');
  });

  it('mounts code read-only, output read-write, inputs read-only', () => {
    const env = findEnvironment('cpu-python-3.11')!;
    const cmd = buildDockerRunCommand({
      runId: 'test-run',
      environment: env,
      codeDir: '/tmp/code',
      inputDirs: new Map([
        ['data', '/tmp/input-data'],
        ['model', '/tmp/input-model'],
      ]),
      outputDir: '/tmp/output',
      maxMemoryMiB: 256,
      maxProcesses: 16,
      maxDurationMs: 30_000,
    });

    expect(cmd).toContain('/tmp/code:/experiment/code:ro');
    expect(cmd).toContain('/tmp/output:/experiment/output:rw');
    expect(cmd).toContain('/tmp/input-data:/experiment/inputs/data:ro');
    expect(cmd).toContain('/tmp/input-model:/experiment/inputs/model:ro');
  });

  it('derives safe container name', () => {
    expect(deriveContainerName('run-001')).toBe('exp-run-001');
    expect(deriveContainerName('a/b/c')).toBe('exp-a-b-c');
    expect(deriveContainerName('x'.repeat(100)).length).toBeLessThanOrEqual(64);
  });
});
