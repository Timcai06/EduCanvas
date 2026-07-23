import {
  normalizeModelGatewayError,
  turnModelEventSchema,
  type ModelAbortSignal,
  type NormalizedModelError,
  type ProviderCallMetadata,
  type StreamTurnTextRequest,
  type TurnModelEvent,
  type TurnModelGateway,
} from '@educanvas/agent-core';

/**
 * Turn 引擎 — 对模型网关事件流做零信任验证。
 *
 * ## 设计原则
 *
 * 模型供应商返回的 SSE 事件流**不可信** — 可能格式错误、阶段混乱、工具调用 ID 重复、
 * 文本和工具调用混杂、缺少终态、usage 与 completion metadata 不一致。
 * 本模块对所有事件做 strict 解析 + 状态机校验，只产出已验证的结果。
 *
 * ## 验证维度
 *
 * | 维度 | 检查内容 |
 * |------|---------|
 * | 格式 | Zod strict 解析，拒绝未知字段 |
 * | 阶段 | 所有事件的 phase 必须与请求一致 |
 * | 终态 | 恰有一个 completed/failed 事件 |
 * | 文本/工具互斥 | text_delta 不能在 tool_call 之后出现（ADR-0011：允许前导文本但不允许反向） |
 * | 工具预算 | 每 turn 最多 4 个工具调用，参数最长 64KB |
 * | 文本预算 | 跨 answer/synthesis 累积不超过 128K 字符 |
 * | ID 唯一 | callId 不能重复标记 done |
 * | 终态一致性 | metadata 的 taskAlias/modelAlias/traceId 必须与请求一致 |
 * | Usage 一致性 | 流中 usage 事件和 completion metadata 的 usage 必须相同 |
 * | finishReason | 有工具调用时必须是 tool_calls，无工具调用时必须是 stop |
 *
 * ## 与 teaching-runtime 的关系
 *
 * M3 从 teaching-runtime 抽取至此。领域策略（提示词、状态机、工具白名单）
 * 留在各自运行时，这里只有**协议与预算**。通用 Agent Turn 和 K12 教学 Turn 共用。
 */

const MAX_TOOL_CALLS_PER_TURN = 4;
const MAX_TOOL_ARGUMENT_BYTES = 64_000;
const MAX_RESPONSE_CHARACTERS = 128_000;

interface ParsedToolCall {
  callId: string;
  tool: string;
  arguments: unknown;
}

interface ModelRunSuccess {
  ok: true;
  toolCalls: readonly ParsedToolCall[];
  metadata: ProviderCallMetadata;
  /** 本次运行是否产生过文本;工具路径用它决定 synthesis 前是否补空行衔接。 */
  hadText: boolean;
  /** 本次运行累计的文本字符数;跨 answer/synthesis 共享回答长度预算(ADR-0011)。 */
  textCharacters: number;
}

interface ModelRunFailure {
  ok: false;
  code:
    | 'MODEL_GATEWAY_FAILED'
    | 'MODEL_ABORTED'
    | 'INVALID_MODEL_STREAM'
    | 'DUPLICATE_TOOL_CALL_ID';
  error: NormalizedModelError;
}

type ModelRunResult = ModelRunSuccess | ModelRunFailure;

interface ToolCallBuffer {
  tool: string;
  argumentsJson: string;
  done: boolean;
}

const invalidModelStream = (
  code: ModelRunFailure['code'] = 'INVALID_MODEL_STREAM',
): ModelRunFailure => ({
  ok: false,
  code,
  error: { code: 'invalid_response', retryable: false },
});

const modelFailure = (error: NormalizedModelError): ModelRunFailure => ({
  ok: false,
  code:
    error.code === 'aborted'
      ? 'MODEL_ABORTED'
      : error.code === 'invalid_response'
        ? 'INVALID_MODEL_STREAM'
        : 'MODEL_GATEWAY_FAILED',
  error,
});

const metadataMatchesRequest = (
  metadata: ProviderCallMetadata,
  request: StreamTurnTextRequest,
): boolean =>
  metadata.taskAlias === request.taskAlias &&
  metadata.modelAlias === request.modelAlias &&
  metadata.traceId === request.traceId;

/** 避免 TypeScript 将只读 signal 快照错误地永久窄化；AbortSignal 可随时间改变。 */
const isAborted = (signal: ModelAbortSignal | undefined): boolean =>
  signal?.aborted === true;

/**
 * 验证一次模型运行的归一化事件流。这里不信任自定义 ModelGateway 的 TS 类型：
 * 事件必须 strict 解析、阶段一致、恰有一个终态，并满足文本/工具互斥。
 */
async function* validateModelRun(
  gateway: TurnModelGateway,
  request: StreamTurnTextRequest,
  /** 之前阶段已消耗的文本字符数;answer 前导文本与 synthesis 共享同一预算。 */
  baseTextCharacters = 0,
): AsyncGenerator<TurnModelEvent, ModelRunResult> {
  const toolCallBuffers = new Map<string, ToolCallBuffer>();
  let terminalSeen = false;
  let terminalEvent: Extract<
    TurnModelEvent,
    { type: 'completed' | 'failed' }
  > | null = null;
  let terminalMetadata: ProviderCallMetadata | null = null;
  let terminalError: NormalizedModelError | null = null;
  let latestUsage: (TurnModelEvent & { type: 'usage' }) | null = null;
  let totalTextCharacters = baseTextCharacters;
  let hasText = false;

  try {
    for await (const rawEvent of gateway.streamTurnText(request)) {
      const parsed = turnModelEventSchema.safeParse(rawEvent);
      if (!parsed.success || terminalSeen) return invalidModelStream();
      const event = parsed.data;
      if (event.phase !== request.phase) return invalidModelStream();

      if (event.type === 'text_delta') {
        /**
         * 文本与工具调用互斥：一旦出现过 tool_call，后续不允许再出 text_delta。
         * ADR-0011：允许"文本 → 工具调用"（前导文本作为引言保留），
         * 但禁止"工具调用 → 文本"（工具结果未验证，后续文本不是可信回答）。
         */
        if (toolCallBuffers.size > 0) return invalidModelStream();
        totalTextCharacters += event.delta.length;
        if (totalTextCharacters > MAX_RESPONSE_CHARACTERS) {
          return invalidModelStream();
        }
        hasText = true;
        yield event;
        continue;
      }
      if (event.type === 'tool_call') {
        /**
         * 工具许可由请求的 tools 列表决定，不由 phase 决定（多圈循环设计）。
         * answer phase 允许带 tools（模型可以调工具），synthesis phase 不带 tools。
         * 如果请求没发 tools 但模型出 tool_call → 非法。
         */
        if (request.tools.length === 0) return invalidModelStream();
        /*
         * ADR-0011:允许"文本 → 工具调用"(前导文本保留为回答第一段);
         * 反向的"工具调用 → 文本"仍在上方 text_delta 分支判死——工具结果
         * 尚未验证,其后的文本不可能是可信回答。
         */
        const existing = toolCallBuffers.get(event.callId);
        if (existing?.done === true) {
          return invalidModelStream('DUPLICATE_TOOL_CALL_ID');
        }
        if (existing !== undefined && existing.tool !== event.tool) {
          return invalidModelStream();
        }
        if (
          existing === undefined &&
          toolCallBuffers.size >= MAX_TOOL_CALLS_PER_TURN
        ) {
          return invalidModelStream();
        }
        const buffer = existing ?? {
          tool: event.tool,
          argumentsJson: '',
          done: false,
        };
        buffer.argumentsJson += event.argumentsDelta;
        if (buffer.argumentsJson.length > MAX_TOOL_ARGUMENT_BYTES) {
          return invalidModelStream();
        }
        buffer.done = event.done;
        toolCallBuffers.set(event.callId, buffer);
        yield event;
        continue;
      }
      if (event.type === 'usage') {
        latestUsage = event; // 记录最后的 usage 事件，用于与终态 metadata 交叉校验
        yield event;
        continue;
      }

      // 以下处理终态事件（completed/failed）
      terminalSeen = true;
      terminalEvent = event;
      if (event.type === 'failed') {
        terminalError = event.error;
        if (
          event.metadata !== undefined &&
          !metadataMatchesRequest(event.metadata, request)
        ) {
          return invalidModelStream();
        }
      } else {
        terminalMetadata = event.metadata;
      }
    }
  } catch (error) {
    return modelFailure(normalizeModelGatewayError(error, request.signal));
  }

  // ═══ 流结束后 — 终态验证 ═══
  if (!terminalSeen) return invalidModelStream();
  if (terminalError !== null) return modelFailure(terminalError);
  if (
    terminalMetadata === null ||
    !metadataMatchesRequest(terminalMetadata, request)
  ) {
    return invalidModelStream();
  }
  if (
    latestUsage !== null &&
    JSON.stringify(latestUsage.usage) !== JSON.stringify(terminalMetadata.usage)
  ) {
    return invalidModelStream();
  }

  const hasTools = toolCallBuffers.size > 0;
  if (!hasText && !hasTools) return invalidModelStream();
  if (request.tools.length === 0 && hasTools) return invalidModelStream();
  if (hasTools && terminalMetadata.finishReason !== 'tool_calls') {
    return invalidModelStream();
  }
  if (!hasTools && terminalMetadata.finishReason === 'tool_calls') {
    return invalidModelStream();
  }

  const toolCalls: ParsedToolCall[] = [];
  for (const [callId, buffer] of toolCallBuffers) {
    if (!buffer.done) return invalidModelStream();
    try {
      toolCalls.push({
        callId,
        tool: buffer.tool,
        arguments: JSON.parse(buffer.argumentsJson) as unknown,
      });
    } catch {
      return invalidModelStream();
    }
  }

  if (terminalEvent === null || terminalEvent.type !== 'completed') {
    return invalidModelStream();
  }
  if (terminalMetadata.finishReason === 'length') {
    return modelFailure({ code: 'output_limit', retryable: true });
  }
  if (!['stop', 'tool_calls'].includes(terminalMetadata.finishReason)) {
    return invalidModelStream();
  }
  yield terminalEvent;
  return {
    ok: true,
    toolCalls,
    metadata: terminalMetadata,
    hadText: hasText,
    textCharacters: totalTextCharacters,
  };
}

export {
  MAX_RESPONSE_CHARACTERS,
  MAX_TOOL_ARGUMENT_BYTES,
  MAX_TOOL_CALLS_PER_TURN,
  invalidModelStream,
  isAborted,
  metadataMatchesRequest,
  modelFailure,
  validateModelRun,
};
export type {
  ModelRunFailure,
  ModelRunResult,
  ModelRunSuccess,
  ParsedToolCall,
};
