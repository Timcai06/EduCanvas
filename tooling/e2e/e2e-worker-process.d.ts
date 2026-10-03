import type { ChildProcess } from 'node:child_process';

export interface E2eWorkerProcess {
  child: ChildProcess;
  stop(graceMs?: number): Promise<void>;
}

export function spawnE2eWorker(input: {
  entrypoint: string;
  cwd: string;
  environment: NodeJS.ProcessEnv;
}): E2eWorkerProcess;
