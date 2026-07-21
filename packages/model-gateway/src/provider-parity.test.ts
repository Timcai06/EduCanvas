import type {
  StreamAgentTextRequest,
  TurnModelEvent,
  TurnModelGateway,
} from '@educanvas/agent-core';
import { AgentLoopEngine } from '@educanvas/agent-runtime';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import type { EnabledModelGatewayConfiguration } from './config';
import { OpenAICompatibleTurnModelGateway } from './openai-compatible-turn-model-gateway';
import { AiSdkResearchTurnModelGateway } from './testing/ai-sdk-turn-model-gateway';
import {
  createFixtureResponse,
  textStreamChunks,
  toolStreamChunks,
} from './testing/openai-compatible-fixtures';

type MockStreamResult = Awaited<ReturnType<MockLanguageModelV3['doStream']>>;
type MockStreamPart =
  MockStreamResult['stream'] extends ReadableStream<infer Part> ? Part : never;

const usage = {
  inputTokens: { total: 24, noCache: 20, cacheRead: 4, cacheWrite: 0 },
  outputTokens: { total: 9, text: 6, reasoning: 3 },
} as const;

const aiTextStream = (): MockStreamResult => ({
  stream: simulateReadableStream<MockStreamPart>({
    chunks: [
      { type: 'stream-start', warnings: [] },
      {
        type: 'response-metadata',
        id: 'fixture-response-id',
        modelId: 'configured-provider-model',
      },
      { type: 'text-start', id: 'text:1' },
      { type: 'text-delta', id: 'text:1', delta: '猫和' },
      { type: 'reasoning-start', id: 'reasoning:1' },
      {
        type: 'reasoning-delta',
        id: 'reasoning:1',
        delta: 'fixture-private-reasoning-never-forward',
      },
      { type: 'reasoning-end', id: 'reasoning:1' },
      {
        type: 'text-delta',
        id: 'text:1',
        delta: '狗可以从耳朵等特征区分。',
      },
      { type: 'text-end', id: 'text:1' },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
      },
    ],
  }),
});

const aiToolStream = (): MockStreamResult => ({
  stream: simulateReadableStream<MockStreamPart>({
    chunks: [
      { type: 'stream-start', warnings: [] },
      {
        type: 'response-metadata',
        id: 'fixture-tool-response-id',
        modelId: 'configured-provider-model',
      },
      {
        type: 'tool-input-start',
        id: 'call_state_1',
        toolName: 'getStudentState',
      },
      { type: 'tool-input-delta', id: 'call_state_1', delta: '{}' },
      { type: 'tool-input-end', id: 'call_state_1' },
      {
        type: 'tool-call',
        toolCallId: 'call_state_1',
        toolName: 'getStudentState',
        input: '{}',
      },
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 18,
            noCache: 18,
            cacheRead: 0,
            cacheWrite: 0,
          },
          outputTokens: { total: 6, text: 6, reasoning: 0 },
        },
      },
    ],
  }),
});

const config: EnabledModelGatewayConfiguration = {
  enabled: true,
  environment: 'local',
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'fixture-key-never-real',
  modelIds: { primary: 'explicitly-configured-model' },
  timeoutMs: 1_000,
  maxOutputTokens: 2_048,
  speechVoice: 'alloy',
  speechTimeoutMs: 60_000,
  speechMaxInputChars: 3_500,
};

const request: StreamAgentTextRequest = {
  taskAlias: 'teaching.turn',
  modelAlias: 'primary',
  phase: 'answer',
  messages: [
    { role: 'system', content: '你是AI老师。' },
    { role: 'user', content: '猫和狗有什么不同？' },
  ],
  tools: [
    {
      name: 'getStudentState',
      description: '读取学生当前学习状态',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ],
  toolResults: [],
  promptVersion: 'provider-parity-v1',
  traceId: 'trace:provider-parity',
  turnId: 'turn:provider-parity',
};

const sequentialFetch = (
  chunks: readonly (readonly unknown[])[],
): typeof fetch => {
  let index = 0;
  return (async () => {
    const next = chunks[index++];
    if (!next) throw new Error('fixture_response_exhausted');
    return createFixtureResponse(next, { splitEvery: 7 });
  }) as typeof fetch;
};

const nativeGateway = (
  responses: readonly (readonly unknown[])[],
): TurnModelGateway =>
  new OpenAICompatibleTurnModelGateway(config, {
    fetchImpl: sequentialFetch(responses),
    now: () => 100,
  });

const aiGateway = (model: MockLanguageModelV3): TurnModelGateway =>
  new AiSdkResearchTurnModelGateway(model, {
    provider: 'ai-sdk-research',
    resolvedModelId: 'explicitly-configured-model',
    timeoutMs: 1_000,
    now: () => 100,
  });

const collect = async (
  gateway: TurnModelGateway,
  input: StreamAgentTextRequest = request,
): Promise<TurnModelEvent[]> => {
  const events: TurnModelEvent[] = [];
  for await (const event of gateway.streamTurnText(input)) events.push(event);
  return events;
};

const semanticTranscript = (events: readonly TurnModelEvent[]) => {
  const calls = new Map<
    string,
    { callId: string; tool: string; arguments: string; done: boolean }
  >();
  for (const event of events) {
    if (event.type !== 'tool_call') continue;
    const existing = calls.get(event.callId) ?? {
      callId: event.callId,
      tool: event.tool,
      arguments: '',
      done: false,
    };
    existing.arguments += event.argumentsDelta;
    existing.done = existing.done || event.done;
    calls.set(event.callId, existing);
  }
  const terminal = events.filter(
    (event) => event.type === 'completed' || event.type === 'failed',
  );
  const usageEvent = events.find((event) => event.type === 'usage');
  const last = terminal.at(-1);
  return {
    text: events
      .filter((event) => event.type === 'text_delta')
      .map((event) => event.delta)
      .join(''),
    calls: [...calls.values()],
    usage: usageEvent?.type === 'usage' ? usageEvent.usage : null,
    terminalCount: terminal.length,
    terminal:
      last?.type === 'completed'
        ? { type: last.type, finishReason: last.metadata.finishReason }
        : last?.type === 'failed'
          ? { type: last.type, error: last.error }
          : null,
  };
};

const runForcedSynthesis = async (gateway: TurnModelGateway) => {
  const events = [];
  for await (const event of new AgentLoopEngine(gateway).stream({
    traceId: request.traceId,
    turnId: request.turnId,
    maxToolRounds: 1,
    answer: {
      taskAlias: request.taskAlias,
      modelAlias: request.modelAlias,
      promptVersion: request.promptVersion,
      messages: request.messages,
      tools: request.tools,
    },
    synthesis: {
      taskAlias: request.taskAlias,
      modelAlias: request.modelAlias,
      promptVersion: request.promptVersion,
      messages: request.messages,
    },
    async executeTools(calls) {
      return {
        ok: true as const,
        results: calls.map((call) => ({
          call,
          modelResult: {
            callId: call.callId,
            tool: call.tool,
            arguments: call.arguments,
            output: { mastery: 0.6 },
          },
          detail: { audited: true },
        })),
      };
    },
  })) {
    events.push(event);
  }
  return events;
};

describe('native and AI SDK provider golden parity', () => {
  it('normalizes text, usage and one terminal without reasoning leakage', async () => {
    const model = new MockLanguageModelV3({ doStream: aiTextStream() });
    const native = semanticTranscript(
      await collect(nativeGateway([textStreamChunks])),
    );
    const candidate = semanticTranscript(await collect(aiGateway(model)));

    expect(candidate).toEqual(native);
    expect(JSON.stringify(candidate)).not.toContain(
      'fixture-private-reasoning-never-forward',
    );
    expect(candidate.terminalCount).toBe(1);
  });

  it('keeps the one-round tool loop and forced synthesis in AgentLoopEngine', async () => {
    const model = new MockLanguageModelV3({
      doStream: [aiToolStream(), aiTextStream()],
    });
    const native = await runForcedSynthesis(
      nativeGateway([toolStreamChunks, textStreamChunks]),
    );
    const candidate = await runForcedSynthesis(aiGateway(model));
    const summarize = (events: typeof native) => ({
      text: events
        .filter(
          (event) =>
            event.type === 'model' && event.event.type === 'text_delta',
        )
        .map((event) =>
          event.type === 'model' && event.event.type === 'text_delta'
            ? event.event.delta
            : '',
        )
        .join(''),
      toolStarted: events.filter((event) => event.type === 'tool.started')
        .length,
      toolResults: events.filter((event) => event.type === 'tool.result')
        .length,
      completed: events.filter((event) => event.type === 'completed').length,
      failed: events.filter((event) => event.type === 'failed').length,
      modelRunCount: events.find((event) => event.type === 'completed'),
    });

    expect(summarize(candidate)).toEqual(summarize(native));
    expect(summarize(candidate)).toMatchObject({
      toolStarted: 1,
      toolResults: 1,
      completed: 1,
      failed: 0,
      modelRunCount: { modelRunCount: 2 },
    });
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
      'tool-result',
    );
  });

  it('normalizes in-flight cancellation to one non-retryable terminal', async () => {
    const waitForAbort = (signal: AbortSignal | undefined): Promise<never> =>
      new Promise((_, reject) => {
        const rejectAbort = () =>
          reject(new DOMException('provider-aborted', 'AbortError'));
        if (signal?.aborted) rejectAbort();
        else signal?.addEventListener('abort', rejectAbort, { once: true });
      });
    const native = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: (async (_input, init) =>
        waitForAbort(init?.signal ?? undefined)) as typeof fetch,
    });
    const model = new MockLanguageModelV3({
      doStream: async ({ abortSignal }) => waitForAbort(abortSignal),
    });
    const controller = new AbortController();
    const nativeRun = collect(native, {
      ...request,
      signal: controller.signal,
    });
    const candidateRun = collect(aiGateway(model), {
      ...request,
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    const nativeResult = semanticTranscript(await nativeRun);
    const candidateResult = semanticTranscript(await candidateRun);
    expect(candidateResult).toEqual(nativeResult);
    expect(candidateResult.terminal).toEqual({
      type: 'failed',
      error: { code: 'aborted', retryable: false },
    });
    expect(candidateResult.terminalCount).toBe(1);
  });

  it('does not expose provider errors or create a second terminal', async () => {
    const secret = 'provider-secret-never-forward';
    const native = new OpenAICompatibleTurnModelGateway(config, {
      fetchImpl: (async () => {
        throw new Error(secret);
      }) as typeof fetch,
    });
    const model = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error(secret);
      },
    });

    const nativeEvents = await collect(native);
    const candidateEvents = await collect(aiGateway(model));
    expect(semanticTranscript(candidateEvents)).toEqual(
      semanticTranscript(nativeEvents),
    );
    expect(JSON.stringify({ nativeEvents, candidateEvents })).not.toContain(
      secret,
    );
    expect(semanticTranscript(candidateEvents).terminalCount).toBe(1);
  });
});
