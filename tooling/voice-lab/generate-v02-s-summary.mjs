/** Build the bounded committed V02-S summary from ignored raw matrix results. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getModelProfile } from './model-profiles.mjs';
import {
  decideVerdict,
  evaluateGroup,
  V02_S_NODE_VERSIONS,
  V02_S_PROFILES,
  V02_S_REPETITIONS,
  V02_S_SCORES,
} from './v02-s-evaluation.mjs';
import { readV02SFixtureManifest } from './v02-s-fixture-manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, 'results/v02-s');
const manifest = readManifest(join(here, 'fixtures/v02-s-human.json'));
const hotwordsSha256 = sha256(join(here, 'fixtures/hotwords-v02-s.txt'));
const groups = [];
const modelEvidence = {};

for (const nodeVersion of V02_S_NODE_VERSIONS) {
  const nodeLabel = nodeVersion.slice(1).replaceAll('.', '-');
  for (const profileName of V02_S_PROFILES) {
    const profile = getModelProfile(profileName);
    for (const score of V02_S_SCORES) {
      const before = [];
      const after = [];
      for (let repetition = 1; repetition <= V02_S_REPETITIONS; repetition++) {
        before.push(
          readJson(
            join(
              resultsDir,
              nodeLabel,
              profileName,
              `score-${score}`,
              `before-${repetition}.json`,
            ),
          ),
        );
        after.push(
          readJson(
            join(
              resultsDir,
              nodeLabel,
              profileName,
              `score-${score}`,
              `after-${repetition}.json`,
            ),
          ),
        );
      }
      validateReports(before, after, nodeVersion, profile, score, manifest);
      const evaluation = evaluateGroup(before, after);
      groups.push({
        node: nodeVersion,
        profile: profileName,
        score,
        ...evaluation,
      });
      modelEvidence[profileName] = {
        id: profile.id,
        source: profile.source,
        license: profile.license,
        languageScope: profile.languageScope,
        modelBytes: before[0].modelBytes,
        hashes: withoutFixtureAndHotwords(before[0].hashes),
      };
    }
  }
}

const decision = decideVerdict(groups);
const summary = {
  schemaVersion: 1,
  experiment: 'V02-S',
  fixture: {
    sourceKind: manifest.sourceKind,
    usageAuthorization: manifest.usageAuthorization,
    expectedText: manifest.expectedText,
    sha256: manifest.sha256,
    sampleRate: manifest.sampleRate,
    channels: manifest.channels,
    encoding: manifest.encoding,
  },
  nodes: V02_S_NODE_VERSIONS,
  controls: {
    engine: 'wasm',
    decodingMethod: 'modified_beam_search',
    maxActivePaths: 4,
    chunkMilliseconds: 100,
    tailSilenceSeconds: 1.5,
    scores: V02_S_SCORES,
    repetitions: V02_S_REPETITIONS,
  },
  models: modelEvidence,
  groups,
  ...decision,
};

const output = join(here, 'evidence/v02-s-summary.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

function validateReports(before, after, nodeVersion, profile, score, fixture) {
  for (const report of [...before, ...after]) {
    const run = report.runs?.[0];
    if (
      report.schemaVersion !== 2 ||
      report.environment?.node !== nodeVersion ||
      report.modelProfile !== profile.id ||
      report.modelSource !== profile.source ||
      report.modelLicense !== profile.license ||
      report.modelLanguageScope !== profile.languageScope ||
      report.modelBytes !== profile.modelBytes ||
      typeof report.model !== 'string' ||
      isAbsolute(report.model) ||
      report.modelingUnit !== profile.modelingUnit ||
      report.decodingMethod !== 'modified_beam_search' ||
      report.maxActivePaths !== 4 ||
      report.chunkMilliseconds !== 100 ||
      report.tailSilenceSeconds !== 1.5 ||
      report.hashes?.fixture !== fixture.sha256 ||
      report.hashes?.encoder !== profile.hashes.encoder ||
      report.hashes?.decoder !== profile.hashes.decoder ||
      report.hashes?.joiner !== profile.hashes.joiner ||
      report.hashes?.tokens !== profile.hashes.tokens ||
      report.hashes?.bpeVocab !== profile.hashes.bpeVocab ||
      !Array.isArray(report.command) ||
      report.command.some(
        (argument) => typeof argument !== 'string' || isAbsolute(argument),
      ) ||
      report.runs?.length !== 1 ||
      run?.engine !== 'wasm' ||
      run?.node !== nodeVersion ||
      run?.fixture !== fixture.audioFile ||
      run?.fixtureSha256 !== fixture.sha256 ||
      run?.error !== null ||
      typeof run?.text !== 'string' ||
      !Number.isFinite(run?.rtf) ||
      !Number.isFinite(run?.peakRssKiB)
    ) {
      fail('V02-S evidence does not match the predeclared matrix.');
    }
  }
  if (before.some((report) => report.hotwordsScore !== null)) {
    fail('Before evidence unexpectedly contains hotwords.');
  }
  if (
    after.some(
      (report) =>
        report.hotwordsScore !== score || report.hashes?.hotwords === null,
    )
  ) {
    fail('After evidence has an invalid hotword configuration.');
  }
  if (
    before.some((report) => report.hashes.hotwords !== null) ||
    after.some((report) => report.hashes.hotwords !== hotwordsSha256)
  ) {
    fail('V02-S evidence has an unexpected hotword hash.');
  }
}

function withoutFixtureAndHotwords(hashes) {
  return {
    encoder: hashes.encoder,
    decoder: hashes.decoder,
    joiner: hashes.joiner,
    tokens: hashes.tokens,
    bpeVocab: hashes.bpeVocab,
  };
}

function readJson(path) {
  if (!existsSync(path)) fail('V02-S formal evidence is incomplete.');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('V02-S formal evidence is invalid JSON.');
  }
}

function readManifest(path) {
  if (!existsSync(path)) fail('V02-S fixture manifest is missing.');
  try {
    return readV02SFixtureManifest(path);
  } catch {
    fail('V02-S fixture manifest is invalid.');
  }
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function sha256(path) {
  if (!existsSync(path)) fail('V02-S hotword configuration is missing.');
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
