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
 *
 * ## 模型别名（Model Alias）
 *
 * 路由档位而非供应商模型名：
 * - primary: 主力模型（DeepSeek 等）
 * - fast: 快速轻量模型
 * - structured: 结构化输出专用
 * - speech: TTS 专用
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

/** 平台已注册的任务别名；供应商模型ID不得作为任务别名进入业务代码。 */
export const taskAliases = [
  ...streamingTaskAliases,
  ...structuredTaskAliases,
  ...speechTaskAliases,
] as const;
export const taskAliasSchema = z.enum(taskAliases);
export type TaskAlias = z.infer<typeof taskAliasSchema>;

/** 路由档位而非供应商模型名。具体模型只允许由服务端适配器解析。 */
export const modelAliases = [
  'primary',
  'fast',
  'structured',
  'speech',
] as const;
export const modelAliasSchema = z.enum(modelAliases);
export type ModelAlias = z.infer<typeof modelAliasSchema>;

/** 单次Agent Turn的两种模型运行阶段；一轮不得出现第三个隐藏阶段。 */
export const turnModelPhases = ['answer', 'synthesis'] as const;
export const turnModelPhaseSchema = z.enum(turnModelPhases);
export type TurnModelPhase = z.infer<typeof turnModelPhaseSchema>;

/**
 * 阶段一供应商调用前的文本兼容消息。通用全模态输入虽然先使用
 * AgentMessagePart 表示，但本契约尚不能携带已验证的原生图片、音频或视频引用；
 * 当前运行时只能把可提取文本的 Asset 物化到 content。后续必须通过独立的
 * ModelInputPart/ProviderCapability 契约扩展，不能把私有 storage key 塞进字符串。
 */
export const modelMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })
  .strict();

export type ModelMessage = z.infer<typeof modelMessageSchema>;

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
