#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const toolingRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const testRoots = [
  'architecture',
  'e2e',
  'local',
  'quality',
  'terminal',
  'testing',
];

function collectTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTests(absolutePath);
    return entry.isFile() && entry.name.endsWith('.test.mjs')
      ? [absolutePath]
      : [];
  });
}

export function discoverToolingTests() {
  return testRoots
    .flatMap((directory) => collectTests(path.join(toolingRoot, directory)))
    .sort();
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = spawnSync(
    process.execPath,
    ['--test', ...discoverToolingTests()],
    {
      cwd: path.resolve(toolingRoot, '..'),
      stdio: 'inherit',
    },
  );
  process.exitCode = result.status ?? 1;
}
