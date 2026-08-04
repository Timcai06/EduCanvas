/** Run the predeclared V02-T Paraformer matrix on explicit Node binaries. */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readV02SFixtureManifest } from './v02-s-fixture-manifest.mjs';
import {
  V02_T_HOTWORD_SCORE,
  V02_T_NODE_VERSIONS,
  V02_T_PROFILE,
  V02_T_REPETITIONS,
} from './v02-t-evaluation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));
const manifest = readV02SFixtureManifest(resolveLocal(options.manifest));
const fixture = resolveLocal(manifest.audioFile);

if (!existsSync(fixture)) fail('V02-T fixture is missing.');
if (sha256(fixture) !== manifest.sha256) fail('V02-T fixture hash mismatch.');

const nodes = [
  { executable: options.node22, expected: V02_T_NODE_VERSIONS[0] },
  { executable: options.node24, expected: V02_T_NODE_VERSIONS[1] },
];
for (const node of nodes) {
  const version = runNode(node.executable, ['--version']).stdout.trim();
  if (version !== node.expected) {
    fail(`Expected ${node.expected}, got ${version || 'no version'}.`);
  }
}

for (const node of nodes) {
  for (let repetition = 1; repetition <= V02_T_REPETITIONS; repetition++) {
    runOne(node, repetition, 'before');
    runOne(node, repetition, 'after');
  }
}

console.log('V02-T formal matrix completed. Generate and review the summary.');

function runOne(node, repetition, mode) {
  const nodeLabel = node.expected.slice(1).replaceAll('.', '-');
  const output = join(
    options.outputDir,
    nodeLabel,
    `${mode}-${repetition}.json`,
  );
  const args = [
    'run-compare.mjs',
    '--engine',
    'wasm',
    '--model-profile',
    V02_T_PROFILE,
    '--fixture',
    manifest.audioFile,
    '--chunk-ms',
    '100',
    '--tail-seconds',
    '1.5',
    '--hotwords-score',
    String(V02_T_HOTWORD_SCORE),
    '--output',
    output,
  ];
  if (mode === 'after') {
    args.push('--hotwords', 'fixtures/hotwords-v02-s.txt');
  }
  rmSync(output, { force: true });
  const result = runNode(node.executable, args, {
    allowEvidenceFailure: mode === 'after',
  });
  if (!existsSync(output)) fail('V02-T run did not produce evidence.');
  if (mode === 'after' && result.status === 1) {
    console.log(`${node.expected} ${mode} ${repetition} (capability rejected)`);
    return;
  }
  console.log(`${node.expected} ${mode} ${repetition}`);
}

function runNode(executable, args, { allowEvidenceFailure = false } = {}) {
  const result = spawnSync(executable, args, {
    cwd: here,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) fail('Failed to start a declared Node executable.');
  if (result.status !== 0 && !(allowEvidenceFailure && result.status === 1)) {
    const stableError = result.stderr.trim().split('\n')[0];
    fail(stableError || `V02-T command failed with exit ${result.status}.`);
  }
  return { status: result.status, stdout: result.stdout };
}

function parseArgs(argv) {
  const parsed = {
    manifest: 'fixtures/generated/v02-t-human.json',
    outputDir: 'results/v02-t',
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
