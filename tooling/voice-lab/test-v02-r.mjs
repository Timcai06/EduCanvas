/**
 * V02-R2 tests: validate JSON output structure, hashes, and summary schema.
 * Usage: node test-v02-r.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  getModelProfile,
  listModelProfiles,
  expectedRequiredModelHashes,
  requiredModelFiles,
} from './model-profiles.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function sha256(filePath) {
  if (!existsSync(filePath)) return null;
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function run(cmd) {
  try {
    return JSON.parse(
      execFileSync(process.execPath, nodeArgs(cmd), {
        encoding: 'utf8',
        cwd: here,
      }),
    );
  } catch (err) {
    const stdout = err.stdout?.toString?.() ?? '';
    try {
      return JSON.parse(stdout);
    } catch {
      return { error: err.message };
    }
  }
}

function runExitCode(cmd, env = {}) {
  try {
    execFileSync(process.execPath, nodeArgs(cmd), {
      encoding: 'utf8',
      cwd: here,
      stdio: 'pipe',
      env: { ...process.env, ...env },
    });
    return 0;
  } catch (err) {
    return err.status ?? 1;
  }
}

function nodeArgs(command) {
  const parts = command.split(' ');
  if (parts.shift() !== 'node') throw new Error('expected_node_command');
  return parts;
}

console.log('V02-R2 Test Suite\n');

// --- Test 0: V02-S model profiles are bounded and explicit ---
console.log('Test 0: V02-S model profiles');
{
  const names = listModelProfiles();
  assert(names.length === 5, 'five bounded model profiles are declared');
  assert(names.includes('current'), 'current profile exists');
  assert(
    names.includes('small-bilingual-fp32'),
    'small bilingual profile exists',
  );
  assert(
    names.includes('paraformer-bilingual-int8'),
    'V02-T Paraformer profile exists',
  );
  assert(
    names.includes('current-bilingual-int8'),
    'V02-U current int8 profile exists',
  );
  assert(
    names.includes('small-bilingual-int8'),
    'V02-U small bilingual int8 profile exists',
  );
  for (const name of names) {
    const profile = getModelProfile(name);
    assert(profile !== null, `${name} resolves`);
    assert(profile.license === 'Apache-2.0', `${name} license is explicit`);
    assert(profile.modelBytes > 0, `${name} model size is explicit`);
    assert(
      profile.source.startsWith(
        'https://github.com/k2-fsa/sherpa-onnx/releases/',
      ),
      `${name} uses an official release URL`,
    );
    assert(requiredModelFiles(profile).length >= 3, `${name} declares files`);
    assert(
      typeof (profile.supportsHotwords ?? true) === 'boolean',
      `${name} hotword capability is explicit`,
    );
    assert(
      typeof (profile.quantization ?? null) === 'string' ||
        profile.quantization === undefined,
      `${name} quantization is explicit`,
    );
    assert(
      /^[a-f0-9]{64}$/.test(profile.archiveSha256),
      `${name} archive hash is explicit`,
    );
    assert(
      Object.values(expectedRequiredModelHashes(profile)).every((hash) =>
        /^[a-f0-9]{64}$/.test(hash),
      ),
      `${name} required file hashes are explicit`,
    );
  }
  assert(getModelProfile('not-declared') === null, 'unknown profile rejected');
}

// --- Test 1: Before JSON has null hotwords/score ---
console.log('Test 1: Before JSON structure');
{
  const data = run('node run-compare.mjs --engine wasm --fixture 0.wav');
  assert(data.schemaVersion === 2, 'schemaVersion is 2');
  assert(
    data.modelProfile === 'current-bilingual-fp32',
    'default profile recorded',
  );
  assert(data.modelLicense === 'Apache-2.0', 'model license recorded');
  assert(data.modelBytes > 0, 'required model byte size recorded');
  assert(data.runs[0].peakRssKiB > 0, 'peak RSS is recorded');
  assert(data.hotwordsScore === null, 'hotwordsScore is null for before');
  assert(data.hashes.hotwords === null, 'hotwords hash is null for before');
  assert(data.hashes.encoder !== null, 'encoder hash present');
  assert(data.hashes.decoder !== null, 'decoder hash present');
  assert(data.hashes.joiner !== null, 'joiner hash present');
  assert(data.hashes.tokens !== null, 'tokens hash present');
  assert(data.hashes.bpeVocab !== null, 'bpeVocab hash present');
  assert(
    typeof data.hashes.fixture === 'string' &&
      data.hashes.fixture.length === 64,
    'fixture hash is 64-char hex',
  );
  assert(data.modelingUnit === 'cjkchar+bpe', 'modelingUnit is cjkchar+bpe');
  assert(
    data.decodingMethod === 'modified_beam_search',
    'decodingMethod is modified_beam_search',
  );
  assert(data.maxActivePaths === 4, 'maxActivePaths is 4');
}

// --- Test 5b: Unknown model profile fails without a stack ---
console.log('\nTest 5b: Unknown model profile failure');
{
  const code = runExitCode(
    'node run-compare.mjs --engine wasm --model-profile not-declared --fixture 0.wav',
  );
  assert(code === 2, 'unknown model profile exits with code 2');
}

// --- Test 2: After JSON has hotwords SHA-256 ---
console.log('\nTest 2: After JSON structure');
{
  const data = run(
    'node run-compare.mjs --engine wasm --fixture 0.wav --hotwords fixtures/hotwords-official-test.txt --hotwords-score 3.5',
  );
  assert(data.hotwordsScore === 3.5, 'hotwordsScore is 3.5');
  assert(data.hashes.hotwords !== null, 'hotwords hash present');
  assert(
    typeof data.hashes.hotwords === 'string' &&
      data.hashes.hotwords.length === 64,
    'hotwords hash is 64-char hex',
  );
}

// --- Test 3: Output contains no absolute paths ---
console.log('\nTest 3: No absolute paths in JSON');
{
  const data = run('node run-compare.mjs --engine wasm --fixture 0.wav');
  const json = JSON.stringify(data);
  assert(!json.includes('/Users/'), 'no /Users/ path');
  assert(!json.includes('/home/'), 'no /home/ path');
  assert(!json.includes('/tmp/'), 'no /tmp/ path');
}

// --- Test 4: File SHA-256 stability ---
console.log('\nTest 4: SHA-256 stability');
{
  const run1 = run('node run-compare.mjs --engine wasm --fixture 0.wav');
  const run2 = run('node run-compare.mjs --engine wasm --fixture 0.wav');
  assert(
    run1.hashes.encoder === run2.hashes.encoder,
    'encoder hash stable across runs',
  );
  assert(
    run1.hashes.decoder === run2.hashes.decoder,
    'decoder hash stable across runs',
  );
  assert(
    run1.hashes.joiner === run2.hashes.joiner,
    'joiner hash stable across runs',
  );
  assert(
    run1.hashes.tokens === run2.hashes.tokens,
    'tokens hash stable across runs',
  );
  assert(
    run1.hashes.bpeVocab === run2.hashes.bpeVocab,
    'bpeVocab hash stable across runs',
  );
  assert(
    run1.hashes.fixture === run2.hashes.fixture,
    'fixture hash stable across runs',
  );
}

// --- Test 5: Missing file fails with exit code ---
console.log('\nTest 5: Missing file failure');
{
  const code = runExitCode(
    'node run-compare.mjs --engine wasm --hotwords nonexistent.txt --fixture 0.wav',
  );
  assert(code === 2, 'missing hotwords exits with code 2');
}

// --- Test 6: Invalid score fails ---
console.log('\nTest 6: Invalid score failure');
{
  const code = runExitCode(
    'node run-compare.mjs --engine wasm --hotwords-score 0 --hotwords fixtures/hotwords-official-test.txt --fixture 0.wav',
  );
  assert(code === 2, 'invalid score exits with code 2');
}

// --- Test 7: Summary schema validation ---
console.log('\nTest 7: Summary schema');
{
  const summaryPath = join(here, 'evidence', 'v02-r-summary.json');
  assert(
    existsSync(summaryPath),
    'committed V02-R summary exists without ignored raw results',
  );
  if (existsSync(summaryPath)) {
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    assert(summary.schemaVersion === 2, 'summary schemaVersion is 2');
    assert(summary.verdict === 'BLOCKED', 'verdict is BLOCKED');
    assert(
      summary.blockerCode === 'target_terms_not_corrected',
      'blockerCode is target_terms_not_corrected',
    );
    assert(
      Array.isArray(summary.preDeclaredMatrix),
      'preDeclaredMatrix is array',
    );
    assert(Array.isArray(summary.results), 'results is array');
    assert(
      Object.keys(summary.modelHashes).length === 5,
      'all model hashes present',
    );
    assert(
      Object.keys(summary.fixtureHashes).length === 4,
      'all fixture hashes present',
    );
    assert(
      Object.values(summary.fixtureHashes).every((hash) =>
        /^[a-f0-9]{64}$/.test(hash),
      ),
      'fixture hashes are SHA-256 values',
    );
    assert(
      Object.values(summary.hotwordHashes).every((hash) =>
        /^[a-f0-9]{64}$/.test(hash),
      ),
      'hotword hashes are SHA-256 values',
    );
    assert(
      summary.results.length === 12,
      'all 12 predeclared combinations are present',
    );
    assert(
      summary.results.every((result) => result.runs === 3 && result.consistent),
      'every combination contains three stable runs',
    );
    assert(
      summary.harnessVerification.changed === true,
      'official harness output changed',
    );
    assert(summary.environment !== undefined, 'environment present');
    assert(
      !JSON.stringify(summary).includes('/Users/'),
      'no absolute paths in summary',
    );
  } else {
    assert(false, 'summary file exists');
  }
}

// --- Test 8: Incomplete evidence cannot produce a summary ---
console.log('\nTest 8: Incomplete evidence fails closed');
{
  const code = runExitCode('node generate-summary.mjs', {
    VOICE_LAB_RESULTS_DIR: `results/missing-${process.pid}`,
  });
  assert(code === 2, 'missing matrix evidence exits with code 2');
}

// --- Test 9: Summary verdict values ---
console.log('\nTest 9: Summary verdict constraints');
{
  const summaryPath = join(here, 'evidence', 'v02-r-summary.json');
  if (existsSync(summaryPath)) {
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    const validVerdicts = ['PASS', 'BLOCKED', 'REVISE'];
    assert(
      validVerdicts.includes(summary.verdict),
      `verdict is one of ${validVerdicts.join(', ')}`,
    );
    if (summary.verdict === 'BLOCKED') {
      assert(
        summary.v03Unlocked === undefined || summary.v03Unlocked === false,
        'V03 not unlocked when BLOCKED',
      );
    }
  }
}

// --- Test 10: Stable error for missing fixture ---
console.log('\nTest 10: Missing fixture error');
{
  const data = run(
    'node run-compare.mjs --engine wasm --fixture nonexistent.wav',
  );
  assert(data.runs[0].error !== null, 'error is non-null');
  assert(
    data.runs[0].error.includes('Fixture is missing'),
    'error mentions missing fixture',
  );
  assert(data.runs[0].text === '', 'text is empty on error');
  assert(data.runs[0].nonEmptyText === false, 'nonEmptyText is false on error');
}

// --- Test 11: Absolute and escaping paths fail closed ---
console.log('\nTest 11: Path boundary');
{
  assert(
    runExitCode(
      'node run-compare.mjs --engine wasm --fixture /tmp/fixture.wav',
    ) === 2,
    'absolute fixture path exits with code 2',
  );
  assert(
    runExitCode(
      'node run-compare.mjs --engine wasm --fixture 0.wav --output ../result.json',
    ) === 2,
    'escaping output path exits with code 2',
  );
  assert(
    runExitCode('node generate-summary.mjs', {
      VOICE_LAB_SUMMARY_PATH: '/tmp/summary.json',
    }) === 2,
    'absolute summary path exits with code 2',
  );
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
process.exitCode = failed > 0 ? 1 : 0;
