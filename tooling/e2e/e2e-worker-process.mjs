import { spawn } from 'node:child_process';

/** Own the actual consumer PID; killing a package-manager wrapper can leave it consuming the next suite's queue. */
export function spawnE2eWorker({ entrypoint, environment, cwd }) {
  const child = spawn(process.execPath, [entrypoint], {
    cwd,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = new Promise((resolve) => child.once('close', resolve));
  let stopping;
  return {
    child,
    stop(graceMs = 5000) {
      stopping ??= (async () => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill('SIGTERM');
        const timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null)
            child.kill('SIGKILL');
        }, graceMs);
        try {
          // close also waits for both audit streams; exit alone does not.
          await closed;
        } finally {
          clearTimeout(timer);
        }
      })();
      return stopping;
    },
  };
}
