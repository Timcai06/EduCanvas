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
 * 通用 Turn 引擎核心(M3,自 teaching-runtime 抽取):对任意 TurnModelGateway
 * 的事件流做不信任验证——strict 解析、阶段一致、恰一终态、预算与工具纪律。
 * K12 Orchestrator 与通用 Agent Turn 共用本模块;领域策略(提示词、状态机、
 * 工具白名单)留在各自运行时,这里只有协议与预算。
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
        /* 工具许可由请求的 tools 列表决定,不由 phase 决定(多圈循环,M3) */
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
        latestUsage = event;
        yield event;
        continue;
      }

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
