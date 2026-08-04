/** Run the predeclared V02-S matrix with explicit Node 22 and Node 24 binaries. */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  V02_S_NODE_VERSIONS,
  V02_S_PROFILES,
  V02_S_REPETITIONS,
  V02_S_SCORES,
} from './v02-s-evaluation.mjs';
import { readV02SFixtureManifest } from './v02-s-fixture-manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));
const manifest = readManifest(resolveLocal(options.manifest));
const fixture = resolveLocal(manifest.audioFile);

if (!existsSync(fixture)) fail('V02-S fixture is missing.');
if (sha256(fixture) !== manifest.sha256) fail('V02-S fixture hash mismatch.');

const nodes = [
  { executable: options.node22, expected: V02_S_NODE_VERSIONS[0] },
  { executable: options.node24, expected: V02_S_NODE_VERSIONS[1] },
];
for (const node of nodes) {
  const version = runNode(node.executable, ['--version']).trim();
  if (version !== node.expected) {
    fail(`Expected ${node.expected}, got ${version || 'no version'}.`);
  }
}

for (const node of nodes) {
  for (const profile of V02_S_PROFILES) {
    for (const score of V02_S_SCORES) {
      for (let repetition = 1; repetition <= V02_S_REPETITIONS; repetition++) {
        runOne(node, profile, score, repetition, 'before');
        runOne(node, profile, score, repetition, 'after');
      }
    }
  }
}

console.log('V02-S formal matrix completed. Generate and review the summary.');

function runOne(node, profile, score, repetition, mode) {
  const nodeLabel = node.expected.slice(1).replaceAll('.', '-');
  const output = join(
    options.outputDir,
    nodeLabel,
    profile,
    `score-${score}`,
    `${mode}-${repetition}.json`,
  );
  const args = [
    'run-compare.mjs',
    '--engine',
    'wasm',
    '--model-profile',
    profile,
    '--fixture',
    manifest.audioFile,
    '--chunk-ms',
    '100',
    '--tail-seconds',
    '1.5',
    '--hotwords-score',
    String(score),
    '--output',
    output,
  ];
  if (mode === 'after') {
    args.push('--hotwords', 'fixtures/hotwords-v02-s.txt');
  }
  runNode(node.executable, args);
  console.log(`${node.expected} ${profile} ${score} ${mode} ${repetition}`);
}

function runNode(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: here,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) fail('Failed to start a declared Node executable.');
  if (result.status !== 0) {
    const stableError = result.stderr.trim().split('\n')[0];
    fail(stableError || `V02-S command failed with exit ${result.status}.`);
  }
  return result.stdout;
}

function readManifest(path) {
  if (!existsSync(path)) fail('V02-S fixture manifest is missing.');
  try {
    return readV02SFixtureManifest(path);
  } catch {
    fail('V02-S fixture manifest is invalid.');
  }
}

function parseArgs(argv) {
  const parsed = {
    manifest: 'fixtures/v02-s-human.json',
    outputDir: 'results/v02-s',
  };
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (option === '--manifest') parsed.manifest = value;
    else if (option === '--output-dir') parsed.outputDir = value;
    else if (option === '--node22') parsed.node22 = value;
    else if (option === '--node24') parsed.node24 = value;
    else fail(`Unknown option: ${option}`);
  }
  if (!parsed.node22 || !parsed.node24) {
    fail('--node22 and --node24 are required.');
  }
  resolveLocal(parsed.outputDir);
  return parsed;
}

function resolveLocal(path) {
  if (typeof path !== 'string' || isAbsolute(path)) {
    fail('Absolute paths are intentionally rejected.');
  }
  const resolved = resolve(here, path);
  const local = relative(here, resolved);
  if (local === '..' || local.startsWith('../') || isAbsolute(local)) {
    fail('Paths outside voice-lab are intentionally rejected.');
  }
  return resolved;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
