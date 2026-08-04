/**
 * Docker command builder — pure function that constructs the `docker run`
 * argument array from validated inputs. No I/O, no side effects.
 */

import type { ExperimentEnvironment } from './environment-whitelist';

export interface DockerCommandInput {
  readonly runId: string;
  readonly environment: ExperimentEnvironment;
  readonly codeDir: string;
  readonly inputDirs: ReadonlyMap<string, string>;
  readonly outputDir: string;
  readonly maxMemoryMiB: number;
  readonly maxProcesses: number;
  readonly maxDurationMs: number;
}

/**
 * Derive a Docker-safe container name from a run ID.
 * Only allows [a-zA-Z0-9._-], truncated to 64 chars.
 */
export function deriveContainerName(runId: string): string {
  const sanitized = runId.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `exp-${sanitized}`.slice(0, 64);
}

export function buildDockerRunCommand(input: DockerCommandInput): string[] {
  const containerName = deriveContainerName(input.runId);
  const stopTimeoutSec = Math.ceil(input.maxDurationMs / 1000) + 5;

  const args: string[] = [
    'docker',
    'run',
    '--name',
    containerName,
    '--rm',
    '--init',
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    '1000:1000',
    '--memory',
    `${input.maxMemoryMiB}m`,
    '--cpus',
    '1',
    '--pids-limit',
    String(input.maxProcesses),
    '--stop-timeout',
    String(stopTimeoutSec),
  ];

  args.push('--volume', `${input.codeDir}:/experiment/code:ro`);
  args.push('--volume', `${input.outputDir}:/experiment/output:rw`);

  for (const [mountName, dirPath] of input.inputDirs) {
    args.push('--volume', `${dirPath}:/experiment/inputs/${mountName}:ro`);
  }

  args.push(input.environment.dockerImage);
  args.push(...input.environment.entrypoint);
  args.push('/experiment/code/main.py');

  return args;
}
