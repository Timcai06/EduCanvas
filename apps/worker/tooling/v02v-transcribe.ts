/**
 * V02-V 手动验证入口：通过现有 resolveAudioTranscriptionModelGateway() 调用
 * OpenAI-compatible /audio/transcriptions，验证「本地草稿 + 云端终稿」双路径
 * 中的 cloudFinal 链路。只做受控验证，不拼接 Provider HTTP 请求、不解析
 * Provider 原始响应；API Key 只从环境变量读取且绝不打印或写入输出。
 *
 * 输出 JSON 只含：schemaVersion、provider、resolvedModelId、transcript、
 * latencyMs、language、durationSeconds、fixtureSha256、稳定错误码。
 * tooling 目录纳入 Worker typecheck，并由 tsx 作为手动 smoke 入口运行。
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AudioTranscriptionRequest,
  ModelAbortSignal,
  SupportedAudioTranscriptionMimeType,
} from '@educanvas/agent-core';
import { ModelGatewayInvocationError } from '@educanvas/agent-core';
import { resolveAudioTranscriptionModelGateway } from '../src/model-runtime.js';

const SCHEMA_VERSION = 1;
const ALLOWED_AUDIO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../tooling/voice-lab/fixtures/generated',
);
const MIME_BY_EXT: Record<string, SupportedAudioTranscriptionMimeType> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
};

const args = parseArgs(process.argv.slice(2));
if (args.errorCode) {
  fail(args.errorCode);
}

// MIME 只由扩展名决定，先于内容校验，保证 unsupported_mime 独立成立。
const mime = MIME_BY_EXT[extname(args.audio).toLowerCase()];
if (!mime) {
  fail('unsupported_mime');
}

const audioPath = resolve(process.cwd(), args.audio);
const relativeAudioPath = relative(ALLOWED_AUDIO_ROOT, audioPath);
if (relativeAudioPath.startsWith('..') || isAbsolute(relativeAudioPath)) {
  fail('audio_path_outside_fixture_root');
}
const fixtureSha256 = fixtureHash(audioPath);
if (args.expectedSha256 && fixtureSha256 !== args.expectedSha256) {
  fail('fixture_sha256_mismatch');
}

const gateway = resolveAudioTranscriptionModelGateway();
if (!gateway) {
  // 未配置 Provider 是确定性结论而非错误：verdict=BLOCKED 与稳定 blockerCode。
  printJson({
    schemaVersion: SCHEMA_VERSION,
    verdict: 'BLOCKED',
    blockerCode: 'transcription_provider_not_configured',
    fixtureSha256,
  });
  process.exit(0);
}

const request: AudioTranscriptionRequest = {
  taskAlias: 'audio.transcribe',
  modelAlias: 'transcription',
  audioBytes: readFileSync(audioPath),
  mimeType: mime,
  promptVersion: 'v02v-manual-smoke',
  traceId: 'v02v-manual-smoke',
  operationId: 'v02v-manual-smoke',
  signal: args.abortAfterMs > 0 ? abortSignal(args.abortAfterMs) : undefined,
};

gateway
  .transcribeAudio(request)
  .then((result) => {
    printJson({
      schemaVersion: SCHEMA_VERSION,
      provider: result.metadata.provider,
      resolvedModelId: result.metadata.resolvedModelId,
      transcript: result.text,
      latencyMs: result.metadata.latencyMs,
      language: result.language,
      durationSeconds: result.durationSeconds,
      fixtureSha256,
    });
    process.exit(0);
  })
  .catch((error: unknown) => {
    const code = stableErrorCode(error);
    printJson({
      schemaVersion: SCHEMA_VERSION,
      errorCode: code,
      fixtureSha256,
    });
    process.exit(1);
  });

function stableErrorCode(error: unknown): string {
  // 只允许归一化稳定码进入输出；原始响应、错误 body、stack 一律丢弃。
  if (error instanceof ModelGatewayInvocationError) {
    return error.normalized.code;
  }
  return 'unknown_error';
}

function fixtureHash(path: string): string {
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0) {
    fail('empty_audio');
  }
  return createHash('sha256').update(bytes).digest('hex');
}

function abortSignal(ms: number): ModelAbortSignal {
  // Node 22+ AbortSignal 满足 ModelAbortSignal 最小契约；超时即取消，
  // 由 gateway 归一化为 aborted，不会把取消伪装成成功。
  return AbortSignal.timeout(ms);
}

function parseArgs(argv: string[]) {
  const parsed: {
    audio: string;
    expectedSha256: string | null;
    abortAfterMs: number;
    errorCode: string | null;
  } = { audio: '', expectedSha256: null, abortAfterMs: 0, errorCode: null };
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (value === undefined) {
      parsed.errorCode = 'invalid_argument';
      break;
    }
    if (option === '--audio') parsed.audio = value;
    else if (option === '--expected-sha256') parsed.expectedSha256 = value;
    else if (option === '--abort-after-ms') parsed.abortAfterMs = Number(value);
    else parsed.errorCode = 'invalid_argument';
  }
  if (parsed.errorCode) return parsed;
  if (!parsed.audio) return { ...parsed, errorCode: 'audio_file_missing' };
  if (isAbsolute(parsed.audio))
    return { ...parsed, errorCode: 'audio_path_absolute' };
  if (!parsed.expectedSha256)
    return { ...parsed, errorCode: 'expected_sha256_required' };
  if (!/^[a-f0-9]{64}$/i.test(parsed.expectedSha256))
    return { ...parsed, errorCode: 'invalid_expected_sha256' };
  try {
    if (statSync(resolve(process.cwd(), parsed.audio)).size === 0) {
      return { ...parsed, errorCode: 'empty_audio' };
    }
  } catch {
    return { ...parsed, errorCode: 'audio_file_missing' };
  }
  return parsed;
}

function fail(errorCode: string): never {
  printJson({ schemaVersion: SCHEMA_VERSION, errorCode });
  process.exit(2);
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
