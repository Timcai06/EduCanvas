import type {
  ModelAbortSignal,
  ModelMessage,
  ModelToolDefinition,
  ModelToolResult,
  NormalizedModelError,
  StreamTurnTextRequest,
  TurnModelEvent,
  TurnModelGateway,
} from '@educanvas/agent-core';
import {
  isAborted,
  validateModelRun,
  type ParsedToolCall,
} from './turn-engine';

export interface AgentLoopPrompt {
  taskAlias: StreamTurnTextRequest['taskAlias'];
  modelAlias: StreamTurnTextRequest['modelAlias'];
  promptVersion: string;
  messages: readonly ModelMessage[];
  tools: readonly ModelToolDefinition[];
}

export interface AgentLoopToolSuccess<TDetail> {
  call: ParsedToolCall;
  modelResult: ModelToolResult;
  detail: TDetail;
}

export type AgentLoopToolBatch<TDetail, TFailure> =
  | { ok: true; results: readonly AgentLoopToolSuccess<TDetail>[] }
  | { ok: false; failure: TFailure };

export interface AgentLoopCommand<TDetail, TFailure> {
  traceId: string;
  turnId: string;
  answer: AgentLoopPrompt;
  synthesis: Omit<AgentLoopPrompt, 'tools'>;
  maxToolRounds: number;
  signal?: ModelAbortSignal;
  executeTools(
    calls: readonly ParsedToolCall[],
    context: { round: number; traceId: string; turnId: string },
  ): Promise<AgentLoopToolBatch<TDetail, TFailure>>;
}

export type AgentLoopEvent<TDetail, TFailure> =
  | { type: 'model'; run: number; event: TurnModelEvent }
  | { type: 'tool.started'; run: number; call: ParsedToolCall }
  | { type: 'tool.result'; run: number; result: AgentLoopToolSuccess<TDetail> }
  | { type: 'completed'; modelRunCount: number }
  | {
      type: 'failed';
      code:
        | 'MODEL_GATEWAY_FAILED'
        | 'MODEL_ABORTED'
        | 'INVALID_MODEL_STREAM'
        | 'DUPLICATE_TOOL_CALL_ID';
      error: NormalizedModelError;
    }
  | { type: 'tool.failed'; failure: TFailure };

/**
 * 所有 Profile 共用的唯一模型/工具循环。Prompt、工具执行与领域副作用由调用方
 * 注入；圈数、跨圈文本预算、取消、强制 synthesis 和终态纪律只在这里实现。
 */
export class AgentLoopEngine {
  constructor(private readonly modelGateway: TurnModelGateway) {}

  async *stream<TDetail, TFailure>(
    command: AgentLoopCommand<TDetail, TFailure>,
  ): AsyncGenerator<AgentLoopEvent<TDetail, TFailure>> {
    const maxToolRounds = Math.min(
      4,
      Math.max(1, Math.trunc(command.maxToolRounds)),
    );
    const accumulatedResults: ModelToolResult[] = [];
    let textCharacters = 0;
    let hadAnyText = false;
    let run = 0;

    for (let round = 1; round <= maxToolRounds; round += 1) {
      run += 1;
      const request: StreamTurnTextRequest = {
        ...command.answer,
        phase: 'answer',
        toolResults: accumulatedResults,
        traceId: command.traceId,
        turnId: command.turnId,
        signal: command.signal,
      };
      const iterator = validateModelRun(
        this.modelGateway,
        request,
        textCharacters,
      )[Symbol.asyncIterator]();
      let separatorPending = hadAnyText;
      let outcome;
      while (true) {
        const step = await iterator.next();
        if (step.done) {
          outcome = step.value;
          break;
        }
        if (separatorPending && step.value.type === 'text_delta') {
          separatorPending = false;
          yield {
            type: 'model',
            run,
            event: { type: 'text_delta', phase: 'answer', delta: '\n\n' },
          };
        }
        yield { type: 'model', run, event: step.value };
      }
      if (!outcome.ok) {
        yield { type: 'failed', code: outcome.code, error: outcome.error };
        return;
      }
      hadAnyText = hadAnyText || outcome.hadText;
      textCharacters = outcome.textCharacters;
      if (outcome.toolCalls.length === 0) {
        yield { type: 'completed', modelRunCount: run };
        return;
      }
      if (isAborted(command.signal)) {
        yield {
          type: 'failed',
          code: 'MODEL_ABORTED',
          error: { code: 'aborted', retryable: false },
        };
        return;
      }
      for (const call of outcome.toolCalls) {
        yield { type: 'tool.started', run, call };
      }
      const executed = await command.executeTools(outcome.toolCalls, {
        round,
        traceId: command.traceId,
        turnId: command.turnId,
      });
      if (!executed.ok) {
        yield { type: 'tool.failed', failure: executed.failure };
        return;
      }
      if (executed.results.length !== outcome.toolCalls.length) {
        yield {
          type: 'failed',
          code: 'INVALID_MODEL_STREAM',
          error: { code: 'invalid_response', retryable: false },
        };
        return;
      }
      for (const [index, result] of executed.results.entries()) {
        const expected = outcome.toolCalls[index];
        if (
          expected === undefined ||
          result.call.callId !== expected.callId ||
          result.call.tool !== expected.tool
        ) {
          yield {
            type: 'failed',
            code: 'INVALID_MODEL_STREAM',
            error: { code: 'invalid_response', retryable: false },
          };
          return;
        }
        accumulatedResults.push(result.modelResult);
        yield { type: 'tool.result', run, result };
      }
    }

    run += 1;
    const synthesisRequest: StreamTurnTextRequest = {
      ...command.synthesis,
      phase: 'synthesis',
      tools: [],
      toolResults: accumulatedResults,
      traceId: command.traceId,
      turnId: command.turnId,
      signal: command.signal,
    };
    const iterator = validateModelRun(
      this.modelGateway,
      synthesisRequest,
      textCharacters,
    )[Symbol.asyncIterator]();
    let separatorPending = hadAnyText;
    while (true) {
      const step = await iterator.next();
      if (step.done) {
        if (!step.value.ok) {
          yield {
            type: 'failed',
            code: step.value.code,
            error: step.value.error,
          };
          return;
        }
        if (step.value.toolCalls.length > 0) {
          yield {
            type: 'failed',
            code: 'INVALID_MODEL_STREAM',
            error: { code: 'invalid_response', retryable: false },
          };
          return;
        }
        yield { type: 'completed', modelRunCount: run };
        return;
      }
      if (separatorPending && step.value.type === 'text_delta') {
        separatorPending = false;
        yield {
          type: 'model',
          run,
          event: { type: 'text_delta', phase: 'synthesis', delta: '\n\n' },
        };
      }
      yield { type: 'model', run, event: step.value };
    }
  }
}
