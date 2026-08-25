import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const desktopRoot = fileURLToPath(new URL('..', import.meta.url));

function repairElectronRuntime() {
  const npmExecPath = process.env.npm_execpath?.trim();
  const command = npmExecPath
    ? process.execPath
    : process.platform === 'win32'
      ? 'pnpm.cmd'
      : 'pnpm';
  const args = npmExecPath
    ? [npmExecPath, 'rebuild', 'electron']
    : ['rebuild', 'electron'];
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    stdio: 'inherit',
  });

  return result.status === 0 && result.error === undefined;
}

function resolveInstalledElectron(resolveElectron, pathExists) {
  try {
    const executablePath = resolveElectron();
    return typeof executablePath === 'string' && pathExists(executablePath)
      ? executablePath
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve Electron through its public entrypoint before electron-vite reads path.txt directly.
 * A missing platform binary gets one package-manager rebuild attempt without coupling the Make
 * target to pnpm's content-addressed layout.
 */
export function ensureElectronRuntime({
  resolveElectron = () => require('electron'),
  pathExists = existsSync,
  repairElectron = repairElectronRuntime,
} = {}) {
  const installedExecutable = resolveInstalledElectron(
    resolveElectron,
    pathExists,
  );
  if (installedExecutable) {
    return installedExecutable;
  }

  let repaired = false;
  try {
    repaired = repairElectron();
  } catch {
    repaired = false;
  }

  if (!repaired) {
    throw new Error(
      'Electron runtime repair failed. Run "pnpm rebuild electron" and retry "make pet".',
    );
  }

  const repairedExecutable = resolveInstalledElectron(
    resolveElectron,
    pathExists,
  );
  if (repairedExecutable) {
    return repairedExecutable;
  }

  throw new Error(
    'Electron runtime is still unavailable after repair. Run "pnpm rebuild electron" and retry "make pet".',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  ensureElectronRuntime();
}
