/** Build the bounded V02-T summary from ignored raw matrix results. */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getModelProfile } from './model-profiles.mjs';
import { readV02SFixtureManifest } from './v02-s-fixture-manifest.mjs';
import {
  decideV02TVerdict,
  evaluateNodeGroup,
  V02_T_HOTWORD_SCORE,
  V02_T_NODE_VERSIONS,
  V02_T_PROFILE,
  V02_T_REPETITIONS,
} from './v02-t-evaluation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, 'results/v02-t');
const manifest = readV02SFixtureManifest(
  join(here, 'fixtures/generated/v02-t-human.json'),
);
const profile = getModelProfile(V02_T_PROFILE);
const hotwordsSha256 = sha256(join(here, 'fixtures/hotwords-v02-s.txt'));
const groups = [];

for (const nodeVersion of V02_T_NODE_VERSIONS) {
  const nodeLabel = nodeVersion.slice(1).replaceAll('.', '-');
  const before = [];
  const after = [];
  for (let repetition = 1; repetition <= V02_T_REPETITIONS; repetition++) {
    before.push(
      readJson(join(resultsDir, nodeLabel, `before-${repetition}.json`)),
    );
    after.push(
      readJson(join(resultsDir, nodeLabel, `after-${repetition}.json`)),
    );
  }
  validateReports(before, after, nodeVersion, profile, manifest);
  groups.push({
    node: nodeVersion,
    evaluation: evaluateNodeGroup(before, after, manifest.expectedText),
  });
}

const decision = decideV02TVerdict(groups);
const summary = {
  schemaVersion: 1,
  experiment: 'V02-T',
  fixture: {
    sourceKind: manifest.sourceKind,
    usageAuthorization: manifest.usageAuthorization,
    expectedText: manifest.expectedText,
    sha256: manifest.sha256,
    sampleRate: manifest.sampleRate,
    channels: manifest.channels,
    encoding: manifest.encoding,
  },
  nodes: V02_T_NODE_VERSIONS,
  controls: {
    engine: 'wasm',
    profile: V02_T_PROFILE,
    decodingMethod: profile.decodingMethod,
    maxActivePaths: profile.maxActivePaths,
    chunkMilliseconds: 100,
    tailSilenceSeconds: 1.5,
    hotwordsScore: V02_T_HOTWORD_SCORE,
    repetitions: V02_T_REPETITIONS,
  },
  model: {
    id: profile.id,
    architecture: profile.architecture,
    source: profile.source,
    sourceRevision: profile.sourceRevision,
    archiveSha256: profile.archiveSha256,
    license: profile.license,
    languageScope: profile.languageScope,
    supportsHotwords: profile.supportsHotwords,
    modelBytes: profile.modelBytes,
    fileSha256: {
      encoderSha256: profile.hashes.encoder,
      decoderSha256: profile.hashes.decoder,
      vocabularySha256: profile.hashes.tokens,
    },
  },
  groups,
  ...decision,
};

const output = join(here, 'evidence/v02-t-summary.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

function validateReports(before, after, nodeVersion, modelProfile, fixture) {
  for (const report of [...before, ...after]) {
    const run = report.runs?.[0];
    if (
      report.schemaVersion !== 2 ||
      report.environment?.node !== nodeVersion ||
      report.modelProfile !== modelProfile.id ||
      report.modelSource !== modelProfile.source ||
      report.modelSourceRevision !== modelProfile.sourceRevision ||
      report.modelLicense !== modelProfile.license ||
      report.modelLanguageScope !== modelProfile.languageScope ||
      report.modelArchitecture !== modelProfile.architecture ||
      report.modelSupportsHotwords !== modelProfile.supportsHotwords ||
      report.modelBytes !== modelProfile.modelBytes ||
      report.decodingMethod !== modelProfile.decodingMethod ||
      report.maxActivePaths !== modelProfile.maxActivePaths ||
      report.chunkMilliseconds !== 100 ||
      report.tailSilenceSeconds !== 1.5 ||
      report.hashes?.fixture !== fixture.sha256 ||
      report.hashes?.encoder !== modelProfile.hashes.encoder ||
      report.hashes?.decoder !== modelProfile.hashes.decoder ||
      report.hashes?.tokens !== modelProfile.hashes.tokens ||
      report.hashes?.joiner !== null ||
      report.hashes?.bpeVocab !== null ||
      !Array.isArray(report.command) ||
      report.command.some(
        (argument) => typeof argument !== 'string' || isAbsolute(argument),
      ) ||
      report.runs?.length !== 1 ||
      run?.engine !== 'wasm' ||
      run?.node !== nodeVersion ||
      run?.fixture !== fixture.audioFile ||
      run?.fixtureSha256 !== fixture.sha256 ||
      typeof run?.text !== 'string' ||
      (typeof run?.error !== 'string' && run?.error !== null)
    ) {
      fail('V02-T evidence does not match the predeclared matrix.');
    }
  }
  if (
    before.some((report) => {
      const run = report.runs[0];
      return (
        run.error !== null ||
        !Number.isFinite(run.rtf) ||
        !Number.isFinite(run.peakRssKiB)
      );
    })
  ) {
    fail('Before evidence did not complete successfully.');
  }
  if (
    before.some(
      (report) =>
        report.hotwordsScore !== null || report.hashes?.hotwords !== null,
    )
  ) {
    fail('Before evidence unexpectedly contains hotwords.');
  }
  if (
    after.some(
      (report) =>
        report.hotwordsScore !== V02_T_HOTWORD_SCORE ||
        report.hashes?.hotwords !== hotwordsSha256,
    )
  ) {
    fail('After evidence has an invalid hotword configuration.');
  }
  if (
    modelProfile.supportsHotwords === false &&
    after.some((report) => {
      const run = report.runs[0];
      return (
        run.error !== 'hotwords_not_supported_by_profile' ||
        run.text !== '' ||
        run.nonEmptyText !== false
      );
    })
  ) {
    fail('After evidence did not record the expected capability rejection.');
  }
}

function readJson(path) {
  if (!existsSync(path)) fail('V02-T formal evidence is incomplete.');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('V02-T formal evidence is invalid JSON.');
  }
}

function sha256(path) {
  if (!existsSync(path)) fail('V02-T hotword configuration is missing.');
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
