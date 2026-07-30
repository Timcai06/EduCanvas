/**
 * 模型网关 Port — 三种独立接口。
 *
 * ## 为什么分三个 Port 而不是一个
 *
 * - **TurnModelGateway**: 流式 Agent 对话 — AsyncIterable，长连接，cancel-able
 * - **StructuredModelGateway**: JSON Schema 约束的结构化生成 — Promise，短请求
 * - **SpeechModelGateway**: TTS 二进制语音合成 — 返回 Uint8Array
 * - **AudioTranscriptionModelGateway**: 音频转录 — 输入字节，输出派生文本
 * - **ImageGenerationModelGateway**: 图像生成 — 输出受限位图字节
 *
 * 分开的好处：调用方显式声明需要哪种网关。TTS 不能用 StructuredModelGateway 返回 base64，
 * Turn 不能用 Promise 一次拿完（需要流式输出给用户）。
 *
 * ModelGateway 是组合类型，组合根可以注入一个多合一的实现。
 */

import type { z } from 'zod';
import type {
  AudioTranscriptionTaskAlias,
  EmbeddingTaskAlias,
  ImageGenerationTaskAlias,
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

/** 音频转录支持的白名单格式；未列入的格式在上传时即被拒绝。 */
export const supportedAudioTranscriptionMimeTypes = [
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/flac',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
] as const;

export type SupportedAudioTranscriptionMimeType =
  (typeof supportedAudioTranscriptionMimeTypes)[number];

/** 音频转录请求。输入为不可变音频字节引用，不传 base64。 */
export interface AudioTranscriptionRequest {
  taskAlias: AudioTranscriptionTaskAlias;
  modelAlias: 'transcription';
  /** 服务端已读取的音频字节。 */
  audioBytes: Uint8Array;
  mimeType: SupportedAudioTranscriptionMimeType;
  promptVersion: string;
  traceId: string;
  operationId: string;
  signal?: ModelAbortSignal;
}

/** 音频转录结果。text 为派生内容，不覆盖原始 Asset Version。 */
export interface AudioTranscriptionResult {
  text: string;
  language: string | null;
  durationSeconds: number | null;
  metadata: ProviderCallMetadata;
}

/**
 * 图像生成首批开放的输出格式白名单。
 *
 * 只收录浏览器可直接安全渲染、且能用魔术字节确定性识别的位图格式：SVG 之类
 * 可携带脚本的矢量格式必须留在白名单外，否则「生成一张图」会变成模型可控的
 * 脚本注入通道（ADR-0004 的分层信任模型）。
 */
export const supportedGeneratedImageMimeTypes = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type SupportedGeneratedImageMimeType =
  (typeof supportedGeneratedImageMimeTypes)[number];

/**
 * 首批开放的尺寸闭集。尺寸直接决定供应商计费与解码内存，因此由平台冻结成
 * 有界枚举，而不是让调用方（更不是模型）传任意宽高。
 */
export const supportedGeneratedImageSizes = [
  '512x512',
  '1024x1024',
  '1024x1536',
  '1536x1024',
] as const;

export type SupportedGeneratedImageSize =
  (typeof supportedGeneratedImageSizes)[number];

/**
 * 图像生成请求。业务侧只传已净化的提示词与稳定别名，不传供应商模型 ID。
 *
 * `count` 上限为 1：首批只支持单图，避免一次工具调用放大成不可预期的计费与
 * 存储写入；放开前需要先有配额账本。
 */
export interface ImageGenerationRequest {
  taskAlias: ImageGenerationTaskAlias;
  modelAlias: 'image';
  prompt: string;
  size: SupportedGeneratedImageSize;
  count: 1;
  promptVersion: string;
  traceId: string;
  operationId: string;
  signal?: ModelAbortSignal;
}

/** 单张已通过魔术字节复核的生成图像；字节只活在进程内直到写入对象存储。 */
export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: SupportedGeneratedImageMimeType;
  size: SupportedGeneratedImageSize;
}

/** 图像生成结果；metadata 可安全进入审计记录，Provider 原始响应体不得外泄。 */
export interface ImageGenerationResult {
  images: readonly [GeneratedImage];
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

/** 音频转录专用 Port；输入为音频字节，输出为文本与审计元数据。 */
export interface AudioTranscriptionModelGateway {
  transcribeAudio(
    request: AudioTranscriptionRequest,
  ): Promise<AudioTranscriptionResult>;
}

/**
 * 平台固定的向量维度。
 *
 * pgvector 的索引要求列有确定维度，因此维度是 Schema 级事实而不是运行时配置：
 * 换维度必须走新迁移 + 全量重嵌入，不能靠改环境变量悄悄切换。配置的模型必须
 * 恰好产出该维度（多数供应商支持 `dimensions` 参数截断），否则视为配置错误。
 */
export const PLATFORM_EMBEDDING_DIMENSIONS = 1536 as const;

/**
 * 向量用途。同一模型对「查询」和「被检索段落」通常使用不同指令前缀，两者产出的
 * 向量不可互相比较；它随向量一起持久化，避免日后无法判断某个向量是怎么来的。
 */
export const embeddingPurposes = ['query', 'passage'] as const;
export type EmbeddingPurpose = (typeof embeddingPurposes)[number];

/** 一次向量化请求。批量上限由适配器按配置强制，调用方不得依赖无界批。 */
export interface EmbeddingRequest {
  taskAlias: EmbeddingTaskAlias;
  modelAlias: 'embedding';
  purpose: EmbeddingPurpose;
  inputs: readonly string[];
  promptVersion: string;
  traceId: string;
  operationId: string;
  signal?: ModelAbortSignal;
}

/**
 * 向量的完整身份。缺任何一项都会让「这批向量能不能和那批比较」变成猜测，
 * 因此四项都必须随向量落库（见 CLAUDE.md 的 Embedding 审计要求；切块版本由
 * 调用方从文档解析器版本补齐，不属于模型网关的知识）。
 */
export interface EmbeddingDescriptor {
  provider: string;
  model: string;
  modelVersion: string;
  dimensions: number;
  /** 本次实际使用的指令标识（含用途与指令版本）。 */
  instruction: string;
}

/** 向量化结果；`embeddings` 与请求 `inputs` 一一对应且顺序一致。 */
export interface EmbeddingResult {
  embeddings: readonly (readonly number[])[];
  descriptor: EmbeddingDescriptor;
  metadata: ProviderCallMetadata;
}

/** 向量化专用 Port；检索质量依赖向量身份，不能塞进结构化 JSON 入口。 */
export interface EmbeddingModelGateway {
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}

/** 图像生成专用 Port；不得挂到 StructuredModelGateway 上返回 base64。 */
export interface ImageGenerationModelGateway {
  generateImage(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult>;
}

/** 组合根可提供的完整模型网关。 */
export interface ModelGateway
  extends
    TurnModelGateway,
    StructuredModelGateway,
    SpeechModelGateway,
    AudioTranscriptionModelGateway,
    ImageGenerationModelGateway,
    EmbeddingModelGateway {}
