import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

function findWorkspaceRoot(startDirectory) {
  let current = path.resolve(startDirectory);
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/**
 * Loads repository-local environment files without overriding values explicitly
 * supplied by the shell, CI, or a parent process.
 */
export function loadWorkspaceEnvFiles({
  environment = process.env,
  startDirectory = process.cwd(),
} = {}) {
  const workspaceRoot = findWorkspaceRoot(startDirectory);
  if (!workspaceRoot) return;

  // Local overrides the repository default, while an explicitly inherited
  // process value still wins over both files.
  for (const name of ['.env.local', '.env']) {
    const file = path.join(workspaceRoot, name);
    if (!existsSync(file)) continue;
    const parsed = parseEnv(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      environment[key] ??= value;
    }
  }
}
