#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);
export const composeFile = path.join(
  repoRoot,
  'infrastructure',
  'compose',
  'local.yml',
);

export function composeArgs(...args) {
  return [
    'compose',
    '--project-directory',
    repoRoot,
    '-f',
    composeFile,
    ...args,
  ];
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  execFileSync('docker', composeArgs(...process.argv.slice(2)), {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}
