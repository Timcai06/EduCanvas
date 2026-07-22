import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/** 只填缺失键；shell、CI与进程编排显式注入的环境始终优先。 */
export function loadWorkspaceEnvFiles(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) break;
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
  for (const name of ['.env', '.env.local']) {
    const file = path.join(current, name);
    if (!existsSync(file)) continue;
    const parsed = parseEnv(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      environment[key] ??= value;
    }
  }
}
