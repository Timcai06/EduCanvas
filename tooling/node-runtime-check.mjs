#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.argv[2] ?? process.cwd();
const authority = readFileSync(resolve(repoRoot, '.nvmrc'), 'utf8').trim();
const expected = authority.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
if (!expected) {
  console.error('[node-runtime-check] .nvmrc must contain an exact version');
  process.exit(1);
}

const active = process.versions.node.match(/^(\d+)\.(\d+)\.(\d+)/);
if (!active) {
  console.error('[node-runtime-check] active Node version is invalid');
  process.exit(1);
}

const expectedParts = expected.slice(1).map(Number);
const activeParts = active.slice(1).map(Number);
const sameMajor = activeParts[0] === expectedParts[0];
const firstDifference = activeParts.findIndex(
  (part, index) => part !== expectedParts[index],
);
const meetsFloor =
  firstDifference === -1 ||
  activeParts[firstDifference] > expectedParts[firstDifference];

if (!sameMajor || !meetsFloor) {
  console.error(
    `[node-runtime-check] Node ${expectedParts.join('.')} through ${expectedParts[0]}.x is required; active ${process.versions.node}`,
  );
  process.exit(1);
}

console.log(
  `[node-runtime-check] OK: Node ${process.versions.node} satisfies .nvmrc floor ${expectedParts.join('.')}`,
);
