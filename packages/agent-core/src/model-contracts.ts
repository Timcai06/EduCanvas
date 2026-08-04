/**
 * 模型契约 — 任务别名系统 + 供应商无关的模型类型。
 *
 * ## 任务别名（Task Alias）路由
 *
 * 业务代码不引用供应商模型 ID（如 `deepseek-chat`），而是使用抽象别名。
 * 服务端适配器负责 alias → 具体模型的映射。这保证换模型只改配置，不动业务代码。
 *
 * | 类别 | 别名 | 用途 |
 * |------|------|------|
 * | streaming | agent.turn | 通用 Agent 对话 |
 * | streaming | teaching.turn | K12 教学对话 |
 * | structured | artifact.generate | Artifact 生成（JSON Schema 约束） |
 * | structured | retrieval.query_rewrite | 检索查询改写 |
 * | speech | speech.generate | TTS 语音合成 |
 * | transcription | audio.transcribe | 音频转录 |
 * | image | image.generate | 教学配图生成 |
 * | embedding | retrieval.embed | 检索向量化 |
 *
 * ## 模型别名（Model Alias）
 *
 * 路由档位而非供应商模型名：
 * - primary: 主力模型（DeepSeek 等）
 * - fast: 快速轻量模型
 * - structured: 结构化输出专用
 * - speech: TTS 专用
 * - transcription: 音频转录专用
 * - image: 图像生成专用
 * - embedding: 检索向量化专用
 */

import { z } from 'zod';

/** 可以使用流式文本入口的业务任务；垂直Agent通过稳定别名接入。 */
export const streamingTaskAliases = ['agent.turn', 'teaching.turn'] as const;
export const streamingTaskAliasSchema = z.enum(streamingTaskAliases);
export type StreamingTaskAlias = z.infer<typeof streamingTaskAliasSchema>;

/** 结构化生成服务于Artifact与离线任务，不承载正常对话Turn。 */
export const structuredTaskAliases = [
  'artifact.generate',
  'retrieval.query_rewrite',
] as const;
export const structuredTaskAliasSchema = z.enum(structuredTaskAliases);
export type StructuredTaskAlias = z.infer<typeof structuredTaskAliasSchema>;

/** 二进制语音合成走独立 Port，不混入文本流或结构化 JSON 入口。 */
export const speechTaskAliases = ['speech.generate'] as const;
export const speechTaskAliasSchema = z.enum(speechTaskAliases);
export type SpeechTaskAlias = z.infer<typeof speechTaskAliasSchema>;

/**
 * 音频转录走独立 Port，输入为不可变音频字节而非文本。
 * 转录结果是派生内容，不覆盖原始 Asset Version。
 */
export const audioTranscriptionTaskAliases = ['audio.transcribe'] as const;
export const audioTranscriptionTaskAliasSchema = z.enum(
  audioTranscriptionTaskAliases,
);
export type AudioTranscriptionTaskAlias = z.infer<
  typeof audioTranscriptionTaskAliasSchema
>;

/**
 * 图像生成走独立 Port，输出为受限二进制而非文本或 JSON。
 * 生成结果是新的 Artifact Version 内容，不覆盖任何既有版本。
 */
export const imageGenerationTaskAliases = ['image.generate'] as const;
export const imageGenerationTaskAliasSchema = z.enum(
  imageGenerationTaskAliases,
);
export type ImageGenerationTaskAlias = z.infer<
  typeof imageGenerationTaskAliasSchema
>;

/**
 * 文本向量化走独立 Port。它既不是对话也不是结构化生成：输出是定长浮点向量，
 * 且必须与产生它的模型、版本、维度和指令一起被审计，否则跨模型的向量会被
 * 当成可比较的坐标，产生看似正常实则无意义的相似度。
 */
export const embeddingTaskAliases = ['retrieval.embed'] as const;
export const embeddingTaskAliasSchema = z.enum(embeddingTaskAliases);
export type EmbeddingTaskAlias = z.infer<typeof embeddingTaskAliasSchema>;

/** 平台已注册的任务别名；供应商模型ID不得作为任务别名进入业务代码。 */
export const taskAliases = [
  ...streamingTaskAliases,
  ...structuredTaskAliases,
  ...speechTaskAliases,
  ...audioTranscriptionTaskAliases,
  ...imageGenerationTaskAliases,
  ...embeddingTaskAliases,
] as const;
export const taskAliasSchema = z.enum(taskAliases);
export type TaskAlias = z.infer<typeof taskAliasSchema>;

/** 路由档位而非供应商模型名。具体模型只允许由服务端适配器解析。 */
export const modelAliases = [
  'primary',
  'fast',
  'structured',
  'speech',
  'transcription',
  'image',
  'embedding',
] as const;
export const modelAliasSchema = z.enum(modelAliases);
export type ModelAlias = z.infer<typeof modelAliasSchema>;

/** 单次Agent Turn的两种模型运行阶段；一轮不得出现第三个隐藏阶段。 */
export const turnModelPhases = ['answer', 'synthesis'] as const;
export const turnModelPhaseSchema = z.enum(turnModelPhases);
export type TurnModelPhase = z.infer<typeof turnModelPhaseSchema>;

/**
 * 供应商调用前的输入片段。
 *
 * 图片一律内联字节，绝不携带私有 storage key 或可回源的 URL：Adapter 会把内容
 * 发给外部供应商，任何形式的内部地址都不能出现在这条路径上。字节由服务端从
 * 已鉴权的不可变 AssetVersion 读出，浏览器不能直接提交。
 *
 * `data` 上限对应上传侧 10MB 原始字节经 base64 膨胀 4/3 后的量；它是防御异常
 * 输入的硬边界，真正该控制张数与总量的地方在物化层。
 */
export const modelInputPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }).strict(),
  z
    .object({
      type: z.literal('image'),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      /** 不带 `data:` 前缀的裸 base64。 */
      data: z.string().min(1).max(14_000_000),
    })
    .strict(),
]);

export type ModelInputPart = z.infer<typeof modelInputPartSchema>;

/**
 * 供应商调用前的消息。
 *
 * content 允许纯字符串或输入片段数组：绝大多数消息仍是纯文本，保留字符串形态
 * 让既有调用方与审计路径不必改写；只有携带原生模态时才升级为数组。
 * Provider 是否真的能读某种模态由 `AgentInputCapabilities` 决定，物化层据此
 * 要么产出原生片段、要么明确失败，不会静默丢弃。
 */
export const modelMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.union([z.string(), z.array(modelInputPartSchema).min(1)]),
  })
  .strict();

export type ModelMessage = z.infer<typeof modelMessageSchema>;

/**
 * 取消息的纯文本投影，用于预算计数、审计摘要和只认字符串的旧路径。
 * 图片片段不参与文本预算，这里按占位符计长度而不是把 base64 计进去。
 */
export function modelMessageText(message: ModelMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .map((part) => (part.type === 'text' ? part.text : '[image]'))
    .join('\n');
}

/** 适配器可见的受控工具定义；handler与供应商SDK类型不会进入契约。 */
export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}

/** 工具执行后回注synthesis的完整、已验证交换。 */
export interface ModelToolResult {
  callId: string;
  tool: string;
  arguments: unknown;
  output: unknown;
}

/** DOM/Node AbortSignal都满足的最小跨运行时取消契约。 */
export interface ModelAbortSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(
    type: 'abort',
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

/** 单次流式Agent模型运行请求。 */
export interface StreamAgentTextRequest {
  taskAlias: StreamingTaskAlias;
  modelAlias: ModelAlias;
  phase: TurnModelPhase;
  messages: readonly ModelMessage[];
  tools: readonly ModelToolDefinition[];
  toolResults: readonly ModelToolResult[];
  promptVersion: string;
  traceId: string;
  turnId: string;
  signal?: ModelAbortSignal;
}

/** @deprecated 使用StreamAgentTextRequest；保留名称用于平滑迁移现有调用方。 */
export type StreamTurnTextRequest = StreamAgentTextRequest;

export const modelUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheHitTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
  })
  .strict();

/** Token统计统一为累计值；供应商不提供的字段由适配器归零。 */
export type ModelUsage = z.infer<typeof modelUsageSchema>;

export const modelFinishReasons = [
  'stop',
  'tool_calls',
  'length',
  'content_filter',
  'cancelled',
  'error',
  'other',
] as const;

export const modelFinishReasonSchema = z.enum(modelFinishReasons);
export type ModelFinishReason = z.infer<typeof modelFinishReasonSchema>;

/** 一次供应商调用完成后可持久化的、无Prompt正文的审计元数据。 */
export const providerCallMetadataSchema = z
  .object({
    providerResponseId: z.string().min(1).max(512).nullable(),
    provider: z.string().min(1).max(128),
    taskAlias: taskAliasSchema,
    modelAlias: modelAliasSchema,
    resolvedModelId: z.string().min(1).max(256),
    modelRevision: z.string().min(1).max(256).nullable(),
    systemFingerprint: z.string().min(1).max(512).nullable(),
    finishReason: modelFinishReasonSchema,
    usage: modelUsageSchema,
    latencyMs: z.number().finite().nonnegative(),
    traceId: z.string().min(1).max(128),
  })
  .strict();

export type ProviderCallMetadata = z.infer<typeof providerCallMetadataSchema>;

export const normalizedModelErrorCodes = [
  'timeout',
  'rate_limit',
  'output_limit',
  'content_filtered',
  'invalid_response',
  'aborted',
  'unavailable',
  'unknown',
] as const;

export const normalizedModelErrorCodeSchema = z.enum(normalizedModelErrorCodes);

export const normalizedModelErrorSchema = z
  .object({
    code: normalizedModelErrorCodeSchema,
    retryable: z.boolean(),
    retryAfterMs: z.number().int().nonnegative().optional(),
  })
  .strict();

/** 可跨应用边界传播的稳定错误；不包含供应商消息、请求体或堆栈。 */
export type NormalizedModelError = z.infer<typeof normalizedModelErrorSchema>;

/** 供应商适配器显式上报归一化错误的异常类型。 */
export class ModelGatewayInvocationError extends Error {
  override readonly name = 'ModelGatewayInvocationError';

  constructor(
    readonly normalized: NormalizedModelError,
    options?: { cause?: unknown },
  ) {
    super(normalized.code, options);
  }
}

/** 将未知异常收敛为稳定、安全的模型错误。 */
export function normalizeModelGatewayError(
  error: unknown,
  signal?: ModelAbortSignal,
): NormalizedModelError {
  if (error instanceof ModelGatewayInvocationError) {
    return normalizedModelErrorSchema.parse(error.normalized);
  }
  if (
    signal?.aborted === true ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'AbortError')
  ) {
    return { code: 'aborted', retryable: false };
  }
  return { code: 'unknown', retryable: false };
}

/** 供应商无关的流式模型事件Schema。 */
export const turnModelEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('text_delta'),
      phase: turnModelPhaseSchema,
      delta: z.string().min(1).max(64_000),
    })
    .strict(),
  z
    .object({
      type: z.literal('tool_call'),
      /* 多圈工具循环(M3):中间轮次均为 answer,但契约不再把 phase 写死——
         工具是否允许由请求的 tools 列表决定,不由 phase 决定 */
      phase: turnModelPhaseSchema,
      callId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9_-]+$/),
      tool: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z][A-Za-z0-9]*$/),
      argumentsDelta: z.string().max(64_000),
      done: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('usage'),
      phase: turnModelPhaseSchema,
      usage: modelUsageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('completed'),
      phase: turnModelPhaseSchema,
      metadata: providerCallMetadataSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('failed'),
      phase: turnModelPhaseSchema,
      error: normalizedModelErrorSchema,
      metadata: providerCallMetadataSchema.optional(),
    })
    .strict(),
]);

/** 每次调用必须且只能以completed或failed结束。 */
export type TurnModelEvent = z.infer<typeof turnModelEventSchema>;

/* 以上事件与请求 contract 是 runtime 校验层的硬边界：
 * 流中任何字段变化都必须经过 schema 重放，无法通过类型断言跳过。
 * 这也决定了终态判断、usage 对齐、模型元数据一致性都应在这之前完成。 */

/* ModelAbortSignal 的最小接口故意与 DOM/Node AbortSignal 对齐，目的是允许
 * Worker/Runtime 复用同一取消语义；任何实现只需保证 aborted/事件监听即可。 */
