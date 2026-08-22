#!/usr/bin/env node

import { constants, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const defaultTemplatePath = path.join(
  repoRoot,
  'config',
  'env',
  'local.env.example',
);
export const defaultTargetPath = path.join(repoRoot, '.env');

export function initializeEnvironment({
  templatePath = defaultTemplatePath,
  targetPath = defaultTargetPath,
} = {}) {
  if (!existsSync(templatePath)) {
    throw new Error(`环境模板不存在: ${templatePath}`);
  }
  if (existsSync(targetPath)) {
    throw new Error(`拒绝覆盖已有环境文件: ${targetPath}`);
  }
  copyFileSync(templatePath, targetPath, constants.COPYFILE_EXCL);
  return targetPath;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const targetPath = initializeEnvironment();
    process.stdout.write(
      `[env-init] created ${path.relative(repoRoot, targetPath)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `[env-init] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
