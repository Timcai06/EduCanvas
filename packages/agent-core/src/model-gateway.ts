/**
 * 模型网关 Port — 三种独立接口。
 *
 * ## 为什么分三个 Port 而不是一个
 *
 * - **TurnModelGateway**: 流式 Agent 对话 — AsyncIterable，长连接，cancel-able
 * - **StructuredModelGateway**: JSON Schema 约束的结构化生成 — Promise，短请求
 * - **SpeechModelGateway**: TTS 二进制语音合成 — 返回 Uint8Array
 *
 * 分开的好处：调用方显式声明需要哪种网关。TTS 不能用 StructuredModelGateway 返回 base64，
 * Turn 不能用 Promise 一次拿完（需要流式输出给用户）。
 *
 * ModelGateway 是组合类型，组合根可以注入一个三合一的实现。
 */

import type { z } from 'zod';
import type {
  ModelAbortSignal,
  ModelAlias,
  ModelMessage,
  ProviderCallMetadata,
  SpeechTaskAlias,
  StreamAgentTextRequest,
  StructuredTaskAlias,
  TurnModelEvent,
} from './model-contracts';

/** 结构化模型调用请求；正常Agent Turn被类型系统排除。 */
export interface StructuredModelRequest<Output> {
  taskAlias: StructuredTaskAlias;
  modelAlias: ModelAlias;
  messages: readonly ModelMessage[];
  schema: z.ZodType<Output>;
  promptVersion: string;
  traceId: string;
  operationId: string;
  signal?: ModelAbortSignal;
}

/** 结构化模型调用结果及审计所需元数据。 */
export interface StructuredModelResult<Output> {
  output: Output;
  metadata: ProviderCallMetadata;
}

export type SpeechAudioFormat = 'mp3';

/** 语音合成请求。业务侧只传受限脚本与稳定别名，不传供应商模型 ID。 */
export interface SpeechSynthesisRequest {
  taskAlias: SpeechTaskAlias;
  modelAlias: 'speech';
  input: string;
  format: SpeechAudioFormat;
  promptVersion: string;
  traceId: string;
  operationId: string;
  signal?: ModelAbortSignal;
}

/** 二进制只活在进程内直到写入对象存储；metadata 可安全进入审计记录。 */
export interface SpeechSynthesisResult {
  bytes: Uint8Array;
  contentType: 'audio/mpeg';
  inputCharacters: number;
  voice: string;
  metadata: ProviderCallMetadata;
}

/** 正常Agent Turn使用的供应商无关Port。 */
export interface TurnModelGateway {
  streamTurnText(
    request: StreamAgentTextRequest,
  ): AsyncIterable<TurnModelEvent>;
}

/** Artifact与离线结构化任务使用的独立Port。 */
export interface StructuredModelGateway {
  generateStructured<Output>(
    request: StructuredModelRequest<Output>,
  ): Promise<StructuredModelResult<Output>>;
}

/** TTS 专用 Port；不得用 StructuredModelGateway 返回 base64。 */
export interface SpeechModelGateway {
  generateSpeech(
    request: SpeechSynthesisRequest,
  ): Promise<SpeechSynthesisResult>;
}

/** 组合根可提供的完整模型网关。 */
export interface ModelGateway
  extends TurnModelGateway, StructuredModelGateway, SpeechModelGateway {}
