import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_PCM_CHUNK_BYTES } from '../../../packages/agent-core/src/index.ts';
import {
  resolveDashScopeStreamingSpeechGateway,
  resolveDashScopeStreamingTranscriptionGateway,
} from '../../../packages/model-gateway/src/index.ts';
import {
  buildProviderCanarySummary,
  validateProviderCanaryInput,
} from './contracts.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const inputPath = resolve(import.meta.dirname, 'scenarios-v1.json');
const outputPath = resolve(repoRoot, 'output/provider-canary/summary.json');
const MAX_IN_MEMORY_PCM_BYTES = 2 * 1024 * 1024;
const SCENARIO_TIMEOUT_MS = 45_000;
const MIN_ROUND_TRIP_SIMILARITY = 0.55;

class CanaryFailure extends Error {
  constructor(readonly stableCode: string) {
    super(stableCode);
  }
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function similarity(left: string, right: string): number {
  const source = [...normalizeText(left)];
  const target = [...normalizeText(right)];
  if (source.length === 0 || target.length === 0) return 0;
  let previous = Array.from({ length: target.length + 1 }, (_, index) => index);
  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    const current = [sourceIndex];
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
      const cost = source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1;
      current[targetIndex] = Math.min(
        current[targetIndex - 1]! + 1,
        previous[targetIndex]! + 1,
        previous[targetIndex - 1]! + cost,
      );
    }
    previous = current;
  }
  return Math.max(
    0,
    1 - previous[target.length]! / Math.max(source.length, target.length),
  );
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  if (total > MAX_IN_MEMORY_PCM_BYTES) {
    throw new CanaryFailure('TTS_OUTPUT_TOO_LARGE');
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/** 24 kHz TTS PCM → 16 kHz ASR PCM；只在内存转换，不写原始音频。 */
function resample24kTo16k(input: Uint8Array): Uint8Array {
  const inputSamples = Math.floor(input.byteLength / 2);
  const outputSamples = Math.floor((inputSamples * 2) / 3);
  const source = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const output = new Uint8Array(outputSamples * 2);
  const target = new DataView(output.buffer);
  for (let index = 0; index < outputSamples; index += 1) {
    const position = index * 1.5;
    const lower = Math.min(inputSamples - 1, Math.floor(position));
    const upper = Math.min(inputSamples - 1, lower + 1);
    const fraction = position - lower;
    const sample = Math.round(
      source.getInt16(lower * 2, true) * (1 - fraction) +
        source.getInt16(upper * 2, true) * fraction,
    );
    target.setInt16(index * 2, sample, true);
  }
  return output;
}

async function runRoundTrip(id: string, text: string): Promise<number> {
  const speech = resolveDashScopeStreamingSpeechGateway(process.env);
  const transcription = resolveDashScopeStreamingTranscriptionGateway(
    process.env,
  );
  if (!speech || !transcription.gateway) {
    throw new CanaryFailure('CONFIGURATION_INVALID');
  }
  const abort = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, SCENARIO_TIMEOUT_MS);
  timer.unref?.();

  try {
    const pcmChunks: Uint8Array[] = [];
    let speechFinished = false;
    const speechSession = speech.beginStreaming({
      taskAlias: 'speech.generate',
      modelAlias: 'speech',
      operationId: `${id}.tts`,
      traceId: `${id}.tts`,
      signal: abort.signal,
    });
    const characters = [...text];
    const splitAt = Math.max(1, Math.floor(characters.length / 2));
    const submissions = [
      characters.slice(0, splitAt).join(''),
      characters.slice(splitAt).join(''),
    ].filter(Boolean);
    submissions.forEach((input, sequence) =>
      speechSession.pushText({ sequence, input }),
    );
    speechSession.finish();
    for await (const event of speechSession.events) {
      if (event.type === 'audio') pcmChunks.push(event.pcmBytes);
      if (event.type === 'finished') speechFinished = true;
      if (event.type === 'failed') {
        throw new CanaryFailure(
          timedOut ? 'SCENARIO_TIMEOUT' : `TTS_${event.failureCode}`,
        );
      }
    }
    if (!speechFinished || pcmChunks.length === 0) {
      throw new CanaryFailure('TTS_EMPTY');
    }

    const pcm16k = resample24kTo16k(concatenate(pcmChunks));
    const operationId = `${id}.asr`;
    const segmentId = `${id}.segment`;
    const session = transcription.gateway.beginStreaming({
      operationId,
      segmentId,
      traceId: `${id}.asr`,
      signal: abort.signal,
    });
    const finalText = (async () => {
      let final: string | null = null;
      for await (const event of session.events) {
        if (event.type === 'final') final = event.text;
        if (event.type === 'failed') {
          throw new CanaryFailure(
            timedOut ? 'SCENARIO_TIMEOUT' : `ASR_${event.failureCode}`,
          );
        }
      }
      if (!final) throw new CanaryFailure('ASR_NO_FINAL');
      return final;
    })();
    let sequence = 0;
    for (
      let offset = 0;
      offset < pcm16k.byteLength;
      offset += MAX_PCM_CHUNK_BYTES
    ) {
      const end = Math.min(pcm16k.byteLength, offset + MAX_PCM_CHUNK_BYTES);
      session.pushChunk({
        operationId,
        segmentId,
        sequence,
        sampleRate: 16_000,
        channels: 1,
        encoding: 'pcm_s16le',
        pcmBytes: pcm16k.slice(offset, end),
      });
      sequence += 1;
    }
    session.finish();
    const score = similarity(text, await finalText);
    if (score < MIN_ROUND_TRIP_SIMILARITY) {
      throw new CanaryFailure('ROUND_TRIP_MISMATCH');
    }
    return score;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const input = validateProviderCanaryInput(
    JSON.parse(readFileSync(inputPath, 'utf8')),
  );
  if (process.argv.includes('--validate-only')) {
    process.stdout.write(
      `Provider canary input ${input.datasetVersion} is within budget.\n`,
    );
    return;
  }
  const results = [];
  for (const scenario of input.scenarios) {
    const startedAt = Date.now();
    try {
      const roundTripSimilarity = await runRoundTrip(
        scenario.id,
        scenario.text,
      );
      results.push({
        id: scenario.id,
        status: 'passed',
        latencyMs: Date.now() - startedAt,
        roundTripSimilarity,
        stableErrorCode: null,
      });
    } catch (error) {
      results.push({
        id: scenario.id,
        status: 'failed',
        latencyMs: Date.now() - startedAt,
        roundTripSimilarity: 0,
        stableErrorCode:
          error instanceof CanaryFailure ? error.stableCode : 'CANARY_FAILED',
      });
    }
  }
  const summary = buildProviderCanarySummary({
    sha: process.env.GITHUB_SHA,
    datasetVersion: input.datasetVersion,
    turnsPerScenario: input.turnsPerScenario,
    results,
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const line =
    `Provider canary: ${summary.scenarioCount} scenarios, ` +
    `${summary.turnCount} turns, success=${summary.successRate}, ` +
    `p50=${summary.latencyMs.p50}ms, p95=${summary.latencyMs.p95}ms.`;
  process.stdout.write(`${line}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Protected Provider Canary\n\n${line}\n`,
      'utf8',
    );
  }
  if (summary.successRate !== 1) process.exitCode = 1;
}

void main().catch(() => {
  process.stderr.write(
    'Provider canary could not produce a sanitized summary.\n',
  );
  process.exitCode = 1;
});
