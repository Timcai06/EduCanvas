import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  type ModelToolResult,
  type StreamTurnTextRequest,
  type TurnModelGateway,
} from '@educanvas/agent-core';
import {
  AgentLoopEngine,
  type AgentLoopCommand,
  type AgentLoopEvent,
} from '@educanvas/agent-runtime';
import {
  DEEP_RESEARCH_MAX_TOOL_ROUNDS,
  DeepResearchOutputGuard,
} from './general-deep-research';
import { DEEP_RESEARCH_REQUIREMENTS_UNMET_MESSAGE } from './general-deep-research-message';

const insufficientEvidenceMessage = DEEP_RESEARCH_REQUIREMENTS_UNMET_MESSAGE;

function metadata(
  request: StreamTurnTextRequest,
  finishReason: 'stop' | 'tool_calls',
) {
  return {
    providerResponseId: `response:${request.phase}`,
    provider: 'fixture',
    taskAlias: request.taskAlias,
    modelAlias: request.modelAlias,
    resolvedModelId: 'fixture/model',
    modelRevision: null,
    systemFingerprint: null,
    finishReason,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheHitTokens: 0,
      reasoningTokens: 0,
    },
    latencyMs: 1,
    traceId: request.traceId,
  } as const;
}

function textEvents(request: StreamTurnTextRequest, text: string) {
  return [
    { type: 'text_delta' as const, phase: request.phase, delta: text },
    {
      type: 'completed' as const,
      phase: request.phase,
      metadata: metadata(request, 'stop'),
    },
  ];
}

function toolEvents(
  request: StreamTurnTextRequest,
  tools: readonly { name: string; callId: string }[],
) {
  return [
    ...tools.map((tool) => ({
      type: 'tool_call' as const,
      phase: request.phase,
      callId: tool.callId,
      tool: tool.name,
      argumentsDelta: '{}',
      done: true,
    })),
    {
      type: 'completed' as const,
      phase: request.phase,
      metadata: metadata(request, 'tool_calls'),
    },
  ];
}

function loopCommand(
  guard: DeepResearchOutputGuard,
  executeTools: AgentLoopCommand<null, string>['executeTools'],
  maxToolRounds = 3,
): AgentLoopCommand<null, string> {
  const prompt = {
    taskAlias: 'agent.turn' as const,
    modelAlias: 'primary' as const,
    promptVersion: 'research-test-v1',
    messages: [{ role: 'user' as const, content: 'research topic' }],
  };
  return {
    traceId: 'trace:research',
    turnId: 'turn:research',
    maxToolRounds,
    answer: {
      ...prompt,
      tools: [
        { name: 'webSearch', description: 'Search', inputSchema: {} },
        { name: 'fetchWebPage', description: 'Read', inputSchema: {} },
      ],
    },
    synthesis: prompt,
    toolRemediation: guard.toolRemediation,
    executeTools,
  };
}

function researchFixture() {
  const progress = { successfulSearchCount: 0, sourceCount: 0 };
  const guard = new DeepResearchOutputGuard({
    get successfulSearchCount() {
      return progress.successfulSearchCount;
    },
    get sourceCount() {
      return progress.sourceCount;
    },
    hasPersistedCitation(url, citationMarker) {
      return (
        url === `https://example.com/${citationMarker}` &&
        citationMarker <= progress.sourceCount
      );
    },
  });
  let toolCallCount = 0;
  const executeTools: AgentLoopCommand<null, string>['executeTools'] = async (
    calls,
  ) => ({
    ok: true,
    results: calls.map((call) => {
      toolCallCount += 1;
      const citationMarker =
        call.tool === 'fetchWebPage' ? progress.sourceCount + 1 : null;
      if (call.tool === 'webSearch') progress.successfulSearchCount += 3;
      if (citationMarker !== null) progress.sourceCount = citationMarker;
      const modelResult: ModelToolResult = {
        callId: call.callId,
        tool: call.tool,
        arguments: call.arguments,
        output:
          citationMarker === null
            ? { completedQueries: ['broad', 'gap', 'focused'] }
            : {
                url: `https://example.com/${citationMarker}`,
                title: `Source ${citationMarker}`,
                content: `Fetched body ${citationMarker}`,
                citationMarker,
              },
      };
      return { call, modelResult, detail: null };
    }),
  });
  return { guard, progress, executeTools, toolCallCount: () => toolCallCount };
}

async function runGuardedLoop(
  guard: DeepResearchOutputGuard,
  gateway: TurnModelGateway,
  executeTools: AgentLoopCommand<null, string>['executeTools'],
  maxToolRounds = 3,
) {
  const events: AgentLoopEvent<null, string>[] = [];
  for await (const event of new AgentLoopEngine(gateway).stream(
    loopCommand(guard, executeTools, maxToolRounds),
  )) {
    events.push(event);
    if (event.type === 'model' && event.event.type === 'text_delta') {
      await guard.push(event.event.delta);
    } else if (event.type === 'tool.result') {
      guard.onToolResult(event.result.call.tool, event.result.modelResult);
    }
  }
  return events;
}

describe('DeepResearchOutputGuard evidence gates', () => {
  it('holds generated text and emits no report when no research tools ran', async () => {
    const report = '# 摘要\n内部草稿，不应泄漏。[1][2][3][4][5]';
    const guard = new DeepResearchOutputGuard({
      successfulSearchCount: 0,
      sourceCount: 0,
    });

    await expect(guard.push(report)).resolves.toEqual({ kind: 'hold' });
    const result = await guard.finish();
    expect(result).toMatchObject({
      kind: 'block',
      failureCode: 'RESEARCH_REQUIREMENTS_UNMET',
      publicContent: insufficientEvidenceMessage,
    });
    expect(JSON.stringify(result)).not.toContain('内部草稿');
    expect(JSON.stringify(result)).not.toContain('[1][2][3][4][5]');
    expect(guard.toolRemediation.tool).toBe('webSearch');
    expect(guard.toolRemediation.prompt).toContain('调用 webSearch');
  });

  it('discards text drafted before a fetched source and releases only the later report', async () => {
    const progress = {
      successfulSearchCount: 3,
      sourceCount: 5,
      hasPersistedCitation: (url: string, citationMarker: number) =>
        url === 'https://example.com' && citationMarker === 1,
    };
    const report =
      '# 摘要\n结论一[1]，结论二[2]，结论三[3]，结论四[4]，结论五[5]。';
    const guard = new DeepResearchOutputGuard(progress);

    await guard.push('无工具作文，不得随证据报告一起放行。');
    guard.onToolResult('webSearch', {
      callId: 'search_1',
      tool: 'webSearch',
      arguments: {},
      output: { completedQueries: 3 },
    });
    await guard.push('搜索摘要不是可引用来源。');
    guard.onToolResult('fetchWebPage', {
      callId: 'fetch_1',
      tool: 'fetchWebPage',
      arguments: {},
      output: {
        url: 'https://example.com',
        title: 'Example',
        content: '已读取正文',
        citationMarker: 1,
      },
    });
    await guard.push(report);

    await expect(guard.finish()).resolves.toEqual({
      kind: 'emit',
      safeDeltas: [report],
    });
  });

  it('keeps the buffer for a fetch result without a persisted citation marker', async () => {
    const guard = new DeepResearchOutputGuard({
      successfulSearchCount: 3,
      sourceCount: 5,
    });
    const earlier = '先前已有来源支持的内容。';
    const later = '后续补充。[1][2][3][4][5]';
    await guard.push(earlier);
    guard.onToolResult('fetchWebPage', {
      callId: 'fetch_failed_persist',
      tool: 'fetchWebPage',
      arguments: {},
      output: {
        url: 'https://example.com',
        title: 'Example',
        content: '正文没有持久来源标记',
      },
    });
    await guard.push(later);

    await expect(guard.finish()).resolves.toEqual({
      kind: 'emit',
      safeDeltas: [earlier, later],
    });
  });

  it('does not clear buffered text for a same-number marker owned by another URL', async () => {
    const guard = new DeepResearchOutputGuard({
      successfulSearchCount: 3,
      sourceCount: 5,
      hasPersistedCitation: () => false,
    });
    const earlier = '本轮已有来源支持的文本。';
    const later = '继续补充。[1][2][3][4][5]';
    await guard.push(earlier);
    guard.onToolResult('fetchWebPage', {
      callId: 'foreign_fetch',
      tool: 'fetchWebPage',
      arguments: {},
      output: {
        url: 'https://other-operation.example/source',
        title: 'Other operation',
        content: '有效读取，但不是当前操作的来源映射',
        citationMarker: 1,
      },
    });
    await guard.push(later);

    await expect(guard.finish()).resolves.toEqual({
      kind: 'emit',
      safeDeltas: [earlier, later],
    });
  });

  it('keeps a second tool-free answer failed, but releases a report built after synthetic source reads', async () => {
    const report =
      '# 摘要\n结论一[1]，结论二[2]，结论三[3]，结论四[4]，结论五[5]。';
    const progress: {
      successfulSearchCount: number;
      sourceCount: number;
      hasPersistedCitation(url: string, citationMarker: number): boolean;
    } = {
      successfulSearchCount: 0,
      sourceCount: 0,
      hasPersistedCitation: (url: string, citationMarker: number) =>
        url === `https://example.com/${citationMarker}` &&
        citationMarker <= progress.sourceCount,
    };
    const guard = new DeepResearchOutputGuard(progress);
    const requests: StreamTurnTextRequest[] = [];
    let providerCalls = 0;
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        requests.push(request);
        providerCalls += 1;
        if (providerCalls === 1) {
          for (const event of textEvents(request, '无工具调用的模型作文。'))
            yield event;
          return;
        }
        if (providerCalls === 2) {
          for (const event of toolEvents(request, [
            { name: 'webSearch', callId: 'search_1' },
          ]))
            yield event;
          return;
        }
        if (providerCalls === 3) {
          for (const event of toolEvents(
            request,
            [1, 2, 3, 4].map((number) => ({
              name: 'fetchWebPage',
              callId: `fetch_${number}`,
            })),
          ))
            yield event;
          return;
        }
        if (providerCalls === 4) {
          for (const event of toolEvents(request, [
            { name: 'fetchWebPage', callId: 'fetch_5' },
          ]))
            yield event;
          return;
        }
        for (const event of textEvents(request, report)) yield event;
      },
    };
    const events: AgentLoopEvent<null, string>[] = [];
    const loop = new AgentLoopEngine(gateway);
    for await (const event of loop.stream(
      loopCommand(guard, async (calls) => ({
        ok: true,
        results: calls.map((call) => {
          const sourceMarker =
            call.tool === 'fetchWebPage' ? progress.sourceCount + 1 : null;
          const output =
            call.tool === 'webSearch'
              ? {
                  completedQueries: ['broad', 'gap', 'focused'],
                }
              : {
                  url: `https://example.com/${sourceMarker}`,
                  title: `Source ${sourceMarker}`,
                  content: `Fetched body ${sourceMarker}`,
                  citationMarker: sourceMarker,
                };
          if (call.tool === 'webSearch') progress.successfulSearchCount += 3;
          if (sourceMarker !== null) progress.sourceCount = sourceMarker;
          const modelResult: ModelToolResult = {
            callId: call.callId,
            tool: call.tool,
            arguments: call.arguments,
            output,
          };
          return { call, modelResult, detail: null };
        }),
      })),
    )) {
      events.push(event);
      if (event.type === 'model' && event.event.type === 'text_delta') {
        await guard.push(event.event.delta);
      } else if (event.type === 'tool.result') {
        guard.onToolResult(event.result.call.tool, event.result.modelResult);
      }
    }

    expect(providerCalls).toBe(5);
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      content: guard.toolRemediation.prompt,
    });
    expect(requests[4]?.toolResults).toHaveLength(6);
    expect(progress).toMatchObject({
      successfulSearchCount: 3,
      sourceCount: 5,
    });
    expect(events.at(-1)).toMatchObject({ type: 'completed' });
    await expect(guard.finish()).resolves.toEqual({
      kind: 'emit',
      safeDeltas: [report],
    });
  });

  it('does not remediate a valid tool-free final report after research', async () => {
    const report =
      '# 摘要\n结论一[1]，结论二[2]，结论三[3]，结论四[4]，结论五[5]。';
    const fixture = researchFixture();
    const requests: StreamTurnTextRequest[] = [];
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        requests.push(request);
        const events =
          requests.length === 1
            ? toolEvents(request, [{ name: 'webSearch', callId: 'search_1' }])
            : requests.length === 2
              ? toolEvents(
                  request,
                  [1, 2, 3, 4].map((number) => ({
                    name: 'fetchWebPage',
                    callId: `fetch_${number}`,
                  })),
                )
              : requests.length === 3
                ? toolEvents(request, [
                    { name: 'fetchWebPage', callId: 'fetch_5' },
                  ])
                : textEvents(request, report);
        for (const event of events) yield event;
      },
    };

    const events = await runGuardedLoop(
      fixture.guard,
      gateway,
      fixture.executeTools,
      4,
    );

    expect(requests).toHaveLength(4);
    expect(requests[3]?.messages.at(-1)?.content).not.toBe(
      fixture.guard.toolRemediation.prompt,
    );
    expect(requests[3]?.toolResults).toHaveLength(6);
    expect(fixture.toolCallCount()).toBe(6);
    expect(fixture.progress).toEqual({
      successfulSearchCount: 3,
      sourceCount: 5,
    });
    expect(events.at(-1)).toMatchObject({ type: 'completed' });
    await expect(fixture.guard.finish()).resolves.toEqual({
      kind: 'emit',
      safeDeltas: [report],
    });
  });

  it('uses one bounded remediation when a final tool-free report misses 3/5/5', async () => {
    const report = '# 摘要\n结论一[1]，结论二[2]，结论三[3]，结论四[4]。';
    const fixture = researchFixture();
    const requests: StreamTurnTextRequest[] = [];
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        requests.push(request);
        const events =
          requests.length === 1
            ? toolEvents(request, [{ name: 'webSearch', callId: 'search_1' }])
            : requests.length === 2
              ? toolEvents(
                  request,
                  [1, 2, 3, 4].map((number) => ({
                    name: 'fetchWebPage',
                    callId: `fetch_${number}`,
                  })),
                )
              : textEvents(request, report);
        for (const event of events) yield event;
      },
    };

    const events = await runGuardedLoop(
      fixture.guard,
      gateway,
      fixture.executeTools,
    );

    expect(requests).toHaveLength(4);
    expect(requests[2]?.messages.at(-1)?.content).not.toBe(
      fixture.guard.toolRemediation.prompt,
    );
    expect(requests[3]?.messages.at(-1)).toEqual({
      role: 'system',
      content: fixture.guard.toolRemediation.prompt,
    });
    expect(requests[3]?.toolResults).toHaveLength(5);
    expect(fixture.toolCallCount()).toBe(5);
    expect(fixture.progress).toEqual({
      successfulSearchCount: 3,
      sourceCount: 4,
    });
    expect(events.at(-1)).toMatchObject({ type: 'completed' });
    await expect(fixture.guard.finish()).resolves.toMatchObject({
      kind: 'block',
      failureCode: 'RESEARCH_REQUIREMENTS_UNMET',
      publicContent: insufficientEvidenceMessage,
    });
  });

  it('blocks a second tool-free answer and keeps both drafts out of the failure copy', async () => {
    const guard = new DeepResearchOutputGuard({
      successfulSearchCount: 0,
      sourceCount: 0,
    });
    let providerCalls = 0;
    const gateway: TurnModelGateway = {
      async *streamTurnText(request) {
        providerCalls += 1;
        for (const event of textEvents(request, `无证据草稿${providerCalls}`))
          yield event;
      },
    };
    const loop = new AgentLoopEngine(gateway);
    for await (const event of loop.stream(
      loopCommand(guard, async () => ({ ok: true, results: [] }), 1),
    )) {
      if (event.type === 'model' && event.event.type === 'text_delta') {
        await guard.push(event.event.delta);
      }
    }

    expect(providerCalls).toBe(2);
    const result = await guard.finish();
    expect(result).toMatchObject({
      kind: 'block',
      failureCode: 'RESEARCH_REQUIREMENTS_UNMET',
      publicContent: insufficientEvidenceMessage,
    });
    expect(JSON.stringify(result)).not.toContain('无证据草稿');
  });

  it.each([
    {
      label: 'search rounds',
      searches: 2,
      sources: 5,
      report: '[1][2][3][4][5]',
    },
    {
      label: 'read sources',
      searches: 3,
      sources: 4,
      report: '[1][2][3][4][5]',
    },
    {
      label: 'valid citation markers',
      searches: 3,
      sources: 5,
      report: '[1][2][3][4]',
    },
  ])('blocks when the $label threshold is unmet', async (scenario) => {
    const guard = new DeepResearchOutputGuard({
      successfulSearchCount: scenario.searches,
      sourceCount: scenario.sources,
    });
    await guard.push(`# 摘要\n${scenario.report}`);

    await expect(guard.finish()).resolves.toMatchObject({
      kind: 'block',
      failureCode: 'RESEARCH_REQUIREMENTS_UNMET',
      publicContent: insufficientEvidenceMessage,
    });
  });

  it('emits the held report when all three evidence thresholds are met', async () => {
    const report =
      '# 摘要\n结论一[1]，结论二[2]，结论三[3]，结论四[4]，结论五[5]。';
    const guard = new DeepResearchOutputGuard({
      successfulSearchCount: 3,
      sourceCount: 5,
    });

    await expect(guard.push(report)).resolves.toEqual({ kind: 'hold' });
    await expect(guard.finish()).resolves.toEqual({
      kind: 'emit',
      safeDeltas: [report],
    });
  });

  it('keeps the report length cap at 128,000 characters', async () => {
    expect(DEEP_RESEARCH_MAX_TOOL_ROUNDS).toBe(6);
    const valid = new DeepResearchOutputGuard({
      successfulSearchCount: 3,
      sourceCount: 5,
    });
    const atLimit = `${'x'.repeat(127_985)}[1][2][3][4][5]`;
    expect(atLimit).toHaveLength(128_000);
    await expect(valid.push(atLimit)).resolves.toEqual({ kind: 'hold' });
    await expect(valid.finish()).resolves.toMatchObject({ kind: 'emit' });

    const oversized = new DeepResearchOutputGuard({
      successfulSearchCount: 3,
      sourceCount: 5,
    });
    await expect(oversized.push(`${atLimit}x`)).resolves.toMatchObject({
      kind: 'block',
      failureCode: 'BUDGET_EXCEEDED',
    });
  });
});
