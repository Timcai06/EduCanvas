/** Build the bounded committed V02-U summary from ignored raw matrix results. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getModelProfile } from './model-profiles.mjs';
import {
  decideV02UVerdict,
  evaluateV02UGroup,
  V02_U_CHUNK_MS,
  V02_U_DECODING_METHOD,
  V02_U_EXPERIMENT,
  V02_U_HOTWORDS_FILE,
  V02_U_MAX_ACTIVE_PATHS,
  V02_U_NODE_VERSIONS,
  V02_U_PROFILES,
  V02_U_REPETITIONS,
  V02_U_SCORES,
  V02_U_TAIL_SECONDS,
} from './v02-u-evaluation.mjs';
import { readV02UFixtureManifest } from './v02-u-fixture-manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, 'results/v02-u');
const manifest = readManifest(join(here, 'fixtures/v02-u-human.json'));
const hotwordsSha256 = sha256(join(here, V02_U_HOTWORDS_FILE));
const groups = [];
const modelEvidence = {};

for (const nodeVersion of V02_U_NODE_VERSIONS) {
  const nodeLabel = nodeVersion.slice(1).replaceAll('.', '-');
  for (const profileName of V02_U_PROFILES) {
    const profile = getModelProfile(profileName);
    for (const score of V02_U_SCORES) {
      const before = [];
      const after = [];
      for (let repetition = 1; repetition <= V02_U_REPETITIONS; repetition++) {
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
      const evaluation = evaluateV02UGroup(
        before,
        after,
        manifest.expectedText,
      );
      groups.push({
        node: nodeVersion,
        profile: profileName,
        score,
        evaluation,
      });
      modelEvidence[profileName] = {
        id: profile.id,
        quantization: profile.quantization,
        source: profile.source,
        archiveSha256: profile.archiveSha256,
        license: profile.license,
        languageScope: profile.languageScope,
        modelBytes: before[0].modelBytes,
        hashes: withoutFixtureAndHotwords(before[0].hashes),
      };
    }
  }
}

const decision = decideV02UVerdict(groups);
const summary = {
  schemaVersion: 1,
  experiment: V02_U_EXPERIMENT,
  fixture: {
    sourceKind: manifest.sourceKind,
    usageAuthorization: manifest.usageAuthorization,
    expectedText: manifest.expectedText,
    sha256: manifest.sha256,
    sampleRate: manifest.sampleRate,
    channels: manifest.channels,
    encoding: manifest.encoding,
  },
  nodes: V02_U_NODE_VERSIONS,
  controls: {
    engine: 'wasm',
    decodingMethod: V02_U_DECODING_METHOD,
    maxActivePaths: V02_U_MAX_ACTIVE_PATHS,
    chunkMilliseconds: V02_U_CHUNK_MS,
    tailSilenceSeconds: V02_U_TAIL_SECONDS,
    scores: V02_U_SCORES,
    repetitions: V02_U_REPETITIONS,
  },
  models: modelEvidence,
  groups,
  ...decision,
};

const output = join(here, 'evidence/v02-u-summary.json');
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
      report.modelQuantization !== profile.quantization ||
      report.modelSource !== profile.source ||
      report.modelLicense !== profile.license ||
      report.modelLanguageScope !== profile.languageScope ||
      report.modelBytes !== profile.modelBytes ||
      typeof report.model !== 'string' ||
      isAbsolute(report.model) ||
      report.modelingUnit !== profile.modelingUnit ||
      report.decodingMethod !== V02_U_DECODING_METHOD ||
      report.maxActivePaths !== V02_U_MAX_ACTIVE_PATHS ||
      report.chunkMilliseconds !== V02_U_CHUNK_MS ||
      report.tailSilenceSeconds !== V02_U_TAIL_SECONDS ||
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
      fail('V02-U evidence does not match the predeclared matrix.');
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
    fail('V02-U evidence has an unexpected hotword hash.');
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
  if (!existsSync(path)) fail('V02-U formal evidence is incomplete.');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('V02-U formal evidence is invalid JSON.');
  }
}

function readManifest(path) {
  if (!existsSync(path)) fail('V02-U fixture manifest is missing.');
  try {
    return readV02UFixtureManifest(path);
  } catch {
    fail('V02-U fixture manifest is invalid.');
  }
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function sha256(path) {
  if (!existsSync(path)) fail('V02-U hotword configuration is missing.');
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
