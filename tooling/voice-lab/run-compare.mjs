/** Reproducible V01/V02: native Node addon versus Node-hosted WASM. */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  getModelProfile,
  listModelProfiles,
  expectedRequiredModelHashes,
  requiredModelFiles,
} from './model-profiles.mjs';

function sha256(filePath) {
  if (!existsSync(filePath)) return null;
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const modelProfile = getModelProfile(args.modelProfile);
if (!modelProfile) {
  fail(
    `Unknown model profile. Expected one of: ${listModelProfiles().join(', ')}`,
  );
}
const modelDir = process.env.VOICE_LAB_MODEL_DIR
  ? normalize(process.env.VOICE_LAB_MODEL_DIR)
  : join(here, 'models', modelProfile.directory);
const fixtures = args.fixture
  ? [args.fixture]
  : ['0.wav', '1.wav', '2.wav', '3.wav'];
const engines = args.engine === 'both' ? ['native', 'wasm'] : [args.engine];
const hotwordsPath = args.hotwords ? resolveLocal(args.hotwords) : '';
const singleFixturePath =
  fixtures.length === 1 ? resolveFixturePath(fixtures[0]) : null;

if (!existsSync(modelDir)) fail('Model directory is missing.');
validateModelFiles();
if (!engines.every((engine) => engine === 'native' || engine === 'wasm'))
  fail('--engine must be native, wasm, or both');
if (args.hotwords && !existsSync(hotwordsPath))
  fail('Hotword configuration is missing.');

const report = {
  schemaVersion: 2,
  command: process.argv.slice(2),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  hashes: {
    fixture: singleFixturePath ? sha256(singleFixturePath) : null,
    encoder: sha256(join(modelDir, modelProfile.encoder)),
    decoder: sha256(join(modelDir, modelProfile.decoder)),
    joiner: modelProfile.joiner
      ? sha256(join(modelDir, modelProfile.joiner))
      : null,
    tokens: sha256(join(modelDir, modelProfile.tokens)),
    bpeVocab: modelProfile.bpeVocab
      ? sha256(join(modelDir, modelProfile.bpeVocab))
      : null,
    hotwords: args.hotwords ? sha256(hotwordsPath) : null,
  },
  modelProfile: modelProfile.id,
  model: relative(here, modelDir),
  modelSource: modelProfile.source,
  modelSourceRevision: modelProfile.sourceRevision ?? null,
  modelLicense: modelProfile.license,
  modelLanguageScope: modelProfile.languageScope,
  modelBytes: requiredModelFiles(modelProfile).reduce(
    (total, filename) => total + fileSize(join(modelDir, filename)),
    0,
  ),
  modelingUnit: modelProfile.modelingUnit,
  modelArchitecture: modelProfile.architecture,
  modelSupportsHotwords: modelProfile.supportsHotwords ?? true,
  decodingMethod: modelProfile.decodingMethod ?? 'modified_beam_search',
  maxActivePaths: modelProfile.maxActivePaths ?? 4,
  chunkMilliseconds: args.chunkMs,
  tailSilenceSeconds: args.tailSeconds,
  hotwordsScore: args.hotwords ? args.hotwordsScore : null,
  runs: [],
};
for (const engine of engines) {
  const api = loadEngine(engine);
  for (const fixture of fixtures)
    report.runs.push(runFixture(api, engine, fixture));
}
console.log(JSON.stringify(report, null, 2));
if (args.output) {
  const output = resolveLocal(args.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}
process.exitCode = report.runs.some((run) => run.error || !run.nonEmptyText)
  ? 1
  : 0;

function runFixture(api, engine, fixture) {
  const wavPath = resolveFixturePath(fixture);
  const started = performance.now();
  const base = {
    engine,
    fixture,
    fixtureSha256: sha256(wavPath),
    node: process.version,
    packageVersion: api.version,
    packageGitSha: api.gitSha1,
    packageGitDate: api.gitDate,
  };
  try {
    if (!existsSync(wavPath)) throw new Error(`Fixture is missing: ${fixture}`);
    if (args.hotwords && modelProfile.supportsHotwords === false) {
      throw new Error('hotwords_not_supported_by_profile');
    }
    const initStarted = performance.now();
    const recognizer = api.createRecognizer(makeConfig());
    const initMilliseconds = round(performance.now() - initStarted);
    const wave = api.readWave(wavPath);
    if (wave.sampleRate !== 16000)
      throw new Error(`Expected 16 kHz fixture, got ${wave.sampleRate} Hz`);
    if (wave.samples.length === 0)
      throw new Error('Fixture contains no audio samples.');
    const stream = recognizer.createStream();
    const decodeStarted = performance.now();
    const chunkSamples = Math.round((wave.sampleRate * args.chunkMs) / 1000);
    for (let offset = 0; offset < wave.samples.length; offset += chunkSamples) {
      acceptAndDecode(
        api,
        recognizer,
        stream,
        wave.sampleRate,
        wave.samples.subarray(offset, offset + chunkSamples),
      );
    }
    acceptAndDecode(
      api,
      recognizer,
      stream,
      wave.sampleRate,
      new Float32Array(Math.round(wave.sampleRate * args.tailSeconds)),
    );
    stream.inputFinished();
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    const result = recognizer.getResult(stream);
    const decodeMilliseconds = round(performance.now() - decodeStarted);
    const audioSeconds = wave.samples.length / wave.sampleRate;
    const text = result.text ?? '';
    stream.free?.();
    recognizer.free?.();
    return {
      ...base,
      sampleRate: wave.sampleRate,
      samples: wave.samples.length,
      audioSeconds: round(audioSeconds),
      initMilliseconds,
      decodeMilliseconds,
      rtf: round(decodeMilliseconds / (audioSeconds * 1000)),
      peakRssKiB: process.resourceUsage().maxRSS,
      elapsedMilliseconds: round(performance.now() - started),
      text,
      nonEmptyText: text.trim().length > 0,
      error: null,
    };
  } catch (error) {
    return {
      ...base,
      elapsedMilliseconds: round(performance.now() - started),
      text: '',
      nonEmptyText: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function makeConfig() {
  const modelConfig = {
    tokens: join(modelDir, modelProfile.tokens),
    numThreads: 2,
    provider: 'cpu',
    debug: 0,
  };
  if (modelProfile.architecture === 'paraformer') {
    modelConfig.paraformer = {
      encoder: join(modelDir, modelProfile.encoder),
      decoder: join(modelDir, modelProfile.decoder),
    };
  } else {
    modelConfig.transducer = {
      encoder: join(modelDir, modelProfile.encoder),
      decoder: join(modelDir, modelProfile.decoder),
      joiner: join(modelDir, modelProfile.joiner),
    };
    modelConfig.modelingUnit = modelProfile.modelingUnit;
    modelConfig.bpeVocab = join(modelDir, modelProfile.bpeVocab);
  }
  return {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig,
    decodingMethod: modelProfile.decodingMethod ?? 'modified_beam_search',
    maxActivePaths: modelProfile.maxActivePaths ?? 4,
    hotwordsFile: hotwordsPath,
    hotwordsScore: args.hotwordsScore,
  };
}

function loadEngine(engine) {
  if (engine === 'native') {
    const sherpa = require('sherpa-onnx-node');
    return {
      version: sherpa.version,
      gitSha1: sherpa.gitSha1,
      gitDate: sherpa.gitDate,
      readWave: sherpa.readWave,
      createRecognizer: (config) => new sherpa.OnlineRecognizer(config),
      accept: (stream, sampleRate, samples) =>
        stream.acceptWaveform({ sampleRate, samples }),
    };
  }
  const sherpa = require('sherpa-onnx');
  return {
    version: sherpa.version,
    gitSha1: sherpa.gitSha1,
    gitDate: sherpa.gitDate,
    readWave: sherpa.readWave,
    createRecognizer: sherpa.createOnlineRecognizer,
    accept: (stream, sampleRate, samples) =>
      stream.acceptWaveform(sampleRate, samples),
  };
}

function acceptAndDecode(api, recognizer, stream, sampleRate, samples) {
  api.accept(stream, sampleRate, samples);
  while (recognizer.isReady(stream)) recognizer.decode(stream);
}
function parseArgs(argv) {
  const parsed = {
    engine: 'both',
    modelProfile: 'current',
    chunkMs: 100,
    tailSeconds: 1.5,
    hotwordsScore: 1.5,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const [option, value] = [argv[index], argv[index + 1]];
    if (option === '--engine') parsed.engine = value;
    else if (option === '--model-profile') parsed.modelProfile = value;
    else if (option === '--fixture') parsed.fixture = value;
    else if (option === '--hotwords') parsed.hotwords = value;
    else if (option === '--output') parsed.output = value;
    else if (option === '--chunk-ms') parsed.chunkMs = Number(value);
    else if (option === '--tail-seconds') parsed.tailSeconds = Number(value);
    else if (option === '--hotwords-score')
      parsed.hotwordsScore = Number(value);
    else fail(`Unknown option: ${option}`);
  }
  if (
    !(parsed.chunkMs > 0) ||
    !(parsed.tailSeconds >= 0) ||
    !(parsed.hotwordsScore > 0)
  )
    fail('Invalid chunk, tail silence, or hotword score.');
  return parsed;
}
function resolveLocal(path) {
  if (isAbsolute(path)) fail('Absolute paths are intentionally rejected.');
  const resolved = resolve(here, path);
  const local = relative(here, resolved);
  if (local === '..' || local.startsWith('../') || isAbsolute(local)) {
    fail('Paths outside voice-lab are intentionally rejected.');
  }
  return resolved;
}
function resolveFixturePath(fixture) {
  return fixture.includes('/')
    ? resolveLocal(fixture)
    : join(modelDir, 'test_wavs', fixture);
}
function round(value) {
  return Number(value.toFixed(4));
}
function fileSize(filePath) {
  if (!existsSync(filePath)) return 0;
  return statSync(filePath).size;
}
function validateModelFiles() {
  for (const [filename, expectedHash] of Object.entries(
    expectedRequiredModelHashes(modelProfile),
  )) {
    const actualHash = sha256(join(modelDir, filename));
    if (actualHash === null)
      fail(`Required model file is missing: ${filename}`);
    if (actualHash !== expectedHash) {
      fail(`Required model file hash mismatch: ${filename}`);
    }
  }
}
function fail(message) {
  console.error(message);
  process.exit(2);
}
