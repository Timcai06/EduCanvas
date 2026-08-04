/** Generate strict, deterministic V02-R evidence from the predeclared matrix. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = resolveLocal(process.env.VOICE_LAB_RESULTS_DIR ?? 'results');
const summaryPath = resolveLocal(
  process.env.VOICE_LAB_SUMMARY_PATH ?? 'evidence/v02-r-summary.json',
);

const matrix = [
  {
    id: 1,
    tag: 'bagging-boosting',
    fixture: 'bagging-boosting.wav',
    fixturePath: 'fixtures/generated/bagging-boosting.wav',
    voice: 'Tingting',
    rate: 80,
    scores: [1.5, 2, 3.5],
  },
  {
    id: 4,
    tag: 'bagging-boosting-fast',
    fixture: 'bagging-boosting-fast.wav',
    fixturePath: 'fixtures/generated/bagging-boosting-fast.wav',
    voice: 'Tingting',
    rate: 120,
    scores: [1.5, 2, 3.5],
  },
  {
    id: 7,
    tag: 'bagging-boosting-slow',
    fixture: 'bagging-boosting-slow.wav',
    fixturePath: 'fixtures/generated/bagging-boosting-slow.wav',
    voice: 'Tingting',
    rate: 50,
    scores: [1.5, 2, 3.5],
  },
  {
    id: 10,
    tag: 'bagging-boosting-en',
    fixture: 'bagging-boosting-en.wav',
    fixturePath: 'fixtures/generated/bagging-boosting-en.wav',
    voice: 'Samantha',
    rate: 80,
    scores: [1.5, 2, 3.5],
  },
];

const BAGGING_HOTWORDS = 'fixtures/hotwords-bagging-boosting.txt';
const OFFICIAL_HOTWORDS = 'fixtures/hotwords-official-test.txt';
const OFFICIAL_BEFORE = 'v02-r2-official-before.json';
const OFFICIAL_AFTER = 'v02-r2-official-after.json';
const invariantHashKeys = [
  'encoder',
  'decoder',
  'joiner',
  'tokens',
  'bpeVocab',
];

function fail(message) {
  console.error(`V02 evidence error: ${message}`);
  process.exit(2);
}

function resolveLocal(value) {
  if (isAbsolute(value)) fail('absolute paths are intentionally rejected');
  const resolved = resolve(here, value);
  const local = relative(here, resolved);
  if (local === '..' || local.startsWith('../') || isAbsolute(local)) {
    fail('path escapes voice-lab');
  }
  return resolved;
}

function sha256(filePath) {
  if (!existsSync(filePath))
    fail(`required file missing: ${relative(here, filePath)}`);
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readReport(fileName) {
  const filePath = join(resultsDir, fileName);
  if (!existsSync(filePath)) fail(`required result missing: ${fileName}`);
  let report;
  try {
    report = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    fail(`invalid JSON result: ${fileName}`);
  }
  if (report.schemaVersion !== 2) fail(`${fileName}: expected schemaVersion 2`);
  if (!Array.isArray(report.runs) || report.runs.length !== 1) {
    fail(`${fileName}: expected exactly one run`);
  }
  const run = report.runs[0];
  if (run.error || !run.nonEmptyText || typeof run.text !== 'string') {
    fail(`${fileName}: recognition run did not succeed`);
  }
  if (!run.fixtureSha256 || run.fixtureSha256 !== report.hashes?.fixture) {
    fail(`${fileName}: fixture hash is missing or inconsistent`);
  }
  return { fileName, report, run };
}

function assertCommonConfig(entry, reference) {
  const { fileName, report, run } = entry;
  if (
    JSON.stringify(report.environment) !== JSON.stringify(reference.environment)
  ) {
    fail(`${fileName}: environment drift`);
  }
  if (report.model !== reference.model) fail(`${fileName}: model path drift`);
  if (report.modelingUnit !== 'cjkchar+bpe')
    fail(`${fileName}: modelingUnit drift`);
  if (report.decodingMethod !== 'modified_beam_search') {
    fail(`${fileName}: decodingMethod drift`);
  }
  if (report.maxActivePaths !== 4) fail(`${fileName}: maxActivePaths drift`);
  if (report.chunkMilliseconds !== 100) fail(`${fileName}: chunk drift`);
  if (report.tailSilenceSeconds !== 1.5) fail(`${fileName}: tail drift`);
  if (run.engine !== 'wasm') fail(`${fileName}: engine drift`);
  for (const key of invariantHashKeys) {
    if (!report.hashes?.[key] || report.hashes[key] !== reference.hashes[key]) {
      fail(`${fileName}: ${key} hash drift`);
    }
  }
}

function exactResultName(tag, score, phase, run) {
  return `v02-r2-${tag}-s${score}-${phase}-${run}.json`;
}

const first = readReport(exactResultName(matrix[0].tag, 1.5, 'before', 1));
const reference = {
  environment: first.report.environment,
  model: first.report.model,
  hashes: Object.fromEntries(
    invariantHashKeys.map((key) => [key, first.report.hashes[key]]),
  ),
};

const fixtureHashes = {};
const results = [];
for (const row of matrix) {
  for (const score of row.scores) {
    const before = [];
    const after = [];
    for (let runNumber = 1; runNumber <= 3; runNumber++) {
      before.push(
        readReport(exactResultName(row.tag, score, 'before', runNumber)),
      );
      after.push(
        readReport(exactResultName(row.tag, score, 'after', runNumber)),
      );
    }
    for (const entry of [...before, ...after])
      assertCommonConfig(entry, reference);

    const expectedFixtureHash = sha256(resolveLocal(row.fixturePath));
    fixtureHashes[row.fixture] = expectedFixtureHash;
    for (const entry of [...before, ...after]) {
      if (entry.run.fixtureSha256 !== expectedFixtureHash) {
        fail(`${entry.fileName}: fixture hash drift`);
      }
    }
    for (const entry of before) {
      if (
        entry.report.hotwordsScore !== null ||
        entry.report.hashes.hotwords !== null
      ) {
        fail(`${entry.fileName}: before run contains hotwords`);
      }
    }
    const expectedHotwordsHash = sha256(resolveLocal(BAGGING_HOTWORDS));
    for (const entry of after) {
      if (
        entry.report.hotwordsScore !== score ||
        entry.report.hashes.hotwords !== expectedHotwordsHash
      ) {
        fail(`${entry.fileName}: after hotword configuration drift`);
      }
    }

    const beforeTranscripts = before.map((entry) => entry.run.text);
    const afterTranscripts = after.map((entry) => entry.run.text);
    const consistent =
      new Set(beforeTranscripts).size === 1 &&
      new Set(afterTranscripts).size === 1;
    if (!consistent)
      fail(`${row.fixture} score ${score}: transcripts are not stable`);

    results.push({
      matrixId: row.id,
      fixture: row.fixture,
      voice: row.voice,
      rate: row.rate,
      score,
      beforeTranscript: beforeTranscripts[0],
      afterTranscript: afterTranscripts[0],
      beforeRtfRange: [
        Math.min(...before.map((entry) => entry.run.rtf)),
        Math.max(...before.map((entry) => entry.run.rtf)),
      ],
      afterRtfRange: [
        Math.min(...after.map((entry) => entry.run.rtf)),
        Math.max(...after.map((entry) => entry.run.rtf)),
      ],
      runs: 3,
      consistent: true,
      outputUnchanged: beforeTranscripts[0] === afterTranscripts[0],
      targetTermsCorrected:
        /\bBAGGING\b/i.test(afterTranscripts[0]) &&
        /\bBOOSTING\b/i.test(afterTranscripts[0]),
    });
  }
}

const officialBefore = readReport(OFFICIAL_BEFORE);
const officialAfter = readReport(OFFICIAL_AFTER);
assertCommonConfig(officialBefore, reference);
assertCommonConfig(officialAfter, reference);
if (officialBefore.report.hotwordsScore !== null)
  fail('official before contains hotwords');
if (
  officialAfter.report.hotwordsScore !== 3.5 ||
  officialAfter.report.hashes.hotwords !==
    sha256(resolveLocal(OFFICIAL_HOTWORDS))
) {
  fail('official after hotword configuration drift');
}

const allTargetTermsCorrected = results.every(
  (result) => result.targetTermsCorrected,
);
const summary = {
  schemaVersion: 2,
  evidenceDate: '2026-08-04',
  environment: reference.environment,
  model: reference.model,
  modelHashes: reference.hashes,
  fixtureHashes,
  hotwordHashes: {
    baggingBoosting: sha256(resolveLocal(BAGGING_HOTWORDS)),
    officialHarness: sha256(resolveLocal(OFFICIAL_HOTWORDS)),
  },
  preDeclaredMatrix: matrix.map(
    ({ tag: _tag, fixturePath: _path, ...row }) => row,
  ),
  results,
  harnessVerification: {
    fixture: 'test_wavs/0.wav',
    fixtureSha256: officialBefore.run.fixtureSha256,
    score: 3.5,
    before: officialBefore.run.text,
    after: officialAfter.run.text,
    changed: officialBefore.run.text !== officialAfter.run.text,
  },
  verdict: allTargetTermsCorrected ? 'PASS' : 'BLOCKED',
  blockerCode: allTargetTermsCorrected ? null : 'target_terms_not_corrected',
  v03Unlocked: allTargetTermsCorrected,
};

mkdirSync(dirname(summaryPath), { recursive: true });
writeFileSync(summaryPath, formatSummaryJson(summary));
console.log(`Summary written: ${relative(here, summaryPath)}`);

function formatSummaryJson(value) {
  const expanded = JSON.stringify(value, null, 2);
  const compactNumericArrays = expanded.replace(
    /\[\n\s+([\d.,\s-]+)\n\s+\]/g,
    (_match, contents) =>
      `[${contents
        .split(',')
        .map((part) => part.trim())
        .join(', ')}]`,
  );
  return `${compactNumericArrays}\n`;
}
