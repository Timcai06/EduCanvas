import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface TuiSessionConfig {
  baseUrl: string;
  userId: string;
  token: string;
  expiresAt: string;
}

export function defaultConfigPath(): string {
  return path.join(os.homedir(), '.config', 'educanvas', 'tui.json');
}

export async function saveConfig(
  config: TuiSessionConfig,
  file = defaultConfigPath(),
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(file, 0o600);
}

export async function loadConfig(
  file = defaultConfigPath(),
): Promise<TuiSessionConfig> {
  const value = JSON.parse(await readFile(file, 'utf8')) as TuiSessionConfig;
  if (!value.baseUrl || !value.userId || !value.token || !value.expiresAt) {
    throw new Error('TUI session config is incomplete; run login again');
  }
  return value;
}
