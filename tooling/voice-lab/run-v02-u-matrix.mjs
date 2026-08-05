/** Run the predeclared V02-U matrix with explicit Node 22 and Node 24 binaries. */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  V02_U_HOTWORDS_FILE,
  V02_U_NODE_VERSIONS,
  V02_U_PROFILES,
  V02_U_REPETITIONS,
  V02_U_SCORES,
} from './v02-u-evaluation.mjs';
import { readV02UFixtureManifest } from './v02-u-fixture-manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));
const manifest = readManifest(resolveLocal(options.manifest));
const fixture = resolveLocal(manifest.audioFile);

if (!existsSync(fixture)) fail('V02-U fixture is missing.');
if (sha256(fixture) !== manifest.sha256) fail('V02-U fixture hash mismatch.');

const nodes = [
  { executable: options.node22, expected: V02_U_NODE_VERSIONS[0] },
  { executable: options.node24, expected: V02_U_NODE_VERSIONS[1] },
];
for (const node of nodes) {
  const version = runNode(node.executable, ['--version']).trim();
  if (version !== node.expected) {
    fail(`Expected ${node.expected}, got ${version || 'no version'}.`);
  }
}

for (const node of nodes) {
  for (const profile of V02_U_PROFILES) {
    for (const score of V02_U_SCORES) {
      for (let repetition = 1; repetition <= V02_U_REPETITIONS; repetition++) {
        runOne(node, profile, score, repetition, 'before');
        runOne(node, profile, score, repetition, 'after');
      }
    }
  }
}

console.log('V02-U formal matrix completed. Generate and review the summary.');

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
    args.push('--hotwords', V02_U_HOTWORDS_FILE);
  }
  runNode(node.executable, args);
  console.log(`${node.expected} ${profile} ${score} ${mode} ${repetition}`);
}

function runNode(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: here,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // 单次运行正常 3–5 秒；120 s 上限让同类解码挂起显式失败而不是无限等待。
    timeout: 120000,
  });
  if (result.error) {
    fail(`Failed to start a declared Node executable: ${result.error.message}`);
  }
  if (result.signal || result.status !== 0) {
    const stableError =
      result.stderr.trim().split('\n')[0] ||
      `V02-U command failed with exit ${result.status ?? 'timeout'}.`;
    fail(stableError);
  }
  return result.stdout;
}

function readManifest(path) {
  if (!existsSync(path)) fail('V02-U fixture manifest is missing.');
  try {
    return readV02UFixtureManifest(path);
  } catch {
    fail('V02-U fixture manifest is invalid.');
  }
}

function parseArgs(argv) {
  const parsed = {
    manifest: 'fixtures/v02-u-human.json',
    outputDir: 'results/v02-u',
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
