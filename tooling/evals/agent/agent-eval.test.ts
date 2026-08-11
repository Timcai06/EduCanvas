import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ModelGatewayInvocationError,
  type AgentToolCallLedgerPort,
  type ToolEffectLedgerPort,
  type TurnModelGateway,
} from '@educanvas/agent-core';
import {
  AgentLoopEngine,
  ToolKernel,
  type AgentLoopEvent,
  type ToolKernelAdapter,
  type ToolKernelTrustedContext,
} from '@educanvas/agent-runtime';
import {
  defaultTeachingPreferences,
  evaluateTeachingInput,
  resolveLearnerAdaptationPolicy,
} from '@educanvas/teaching-core';
import { TeachingOutputSafetyGate } from '@educanvas/teaching-runtime';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AGENT_EVAL_DATASET_VERSION,
  TEACHING_SAFETY_CASES,
  TOOL_ARTIFACT_CASES,
  type TeachingSafetyEvalCase,
  type ToolEvalCase,
} from './v1/cases';

const OPERATION_ID = '00000000-0000-4000-8000-000000000001';
const TOOL_CALL_ID = '10000000-0000-4000-8000-000000000001';
const CAPABILITY = 'eval.tool.execute';
const SAFE_CAPABILITY = 'eval.safe.read';
const adapterInvocations = new Map<string, number>();

function metadata(
  request: Parameters<TurnModelGateway['streamTurnText']>[0],
  finishReason: 'stop' | 'tool_calls',
) {
  return {
    providerResponseId: `fixture:${request.phase}`,
    provider: 'fixture',
    taskAlias: request.taskAlias,
    modelAlias: request.modelAlias,
    resolvedModelId: 'fixture/model',
    modelRevision: 'v1',
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

function memoryLedgers() {
  const callLedger = {
    async createOrGet(input) {
      return {
        call: {
          id: TOOL_CALL_ID,
          operationId: input.operationId,
          answerModelRunId: input.answerModelRunId,
          providerToolCallId: input.providerToolCallId,
          executionId: input.executionId,
          traceId: 'trace:agent-eval',
          toolName: input.toolName,
          exposure: input.exposure,
          effect: input.effect,
          argumentSummary: null,
          resultSummary: null,
          status: 'pending',
          code: null,
          retryable: false,
          durationMs: null,
          startedAt: null,
          completedAt: null,
          createdAt: '2026-08-11T00:00:00.000Z',
        },
        replayed: false,
      };
    },
    async markRunning({ toolCallId }) {
      return {
        call: { id: toolCallId, status: 'running' },
        transitioned: true,
      };
    },
    async settle({ toolCallId, status }) {
      return { call: { id: toolCallId, status }, transitioned: true };
    },
    async listByOperation() {
      return [];
    },
  } as unknown as AgentToolCallLedgerPort;
  const effectLedger = {
    async intend() {
      throw new Error('read-only eval adapters must not create effects');
    },
    async settle() {
      throw new Error('read-only eval adapters must not settle effects');
    },
    async get() {
      return null;
    },
  } as unknown as ToolEffectLedgerPort;
  return { callLedger, effectLedger };
}

const toolOutputSchema = z
  .object({
    artifactVersion: z.literal('artifact-v1'),
    operationId: z.string().uuid(),
    executionId: z.string().min(1),
  })
  .strict();

function adapter(
  name: string,
  source: ToolKernelAdapter['source'],
  fail = false,
  capability = CAPABILITY,
): ToolKernelAdapter<{ query: string }, z.infer<typeof toolOutputSchema>> {
  return {
    name,
    description: `deterministic ${source} evaluation adapter`,
    source,
    capability,
    risk: 'l0',
    exposure: 'model',
    effect: 'read',
    timeoutMs: 100,
    inputSchema: z.object({ query: z.string().min(1).max(100) }).strict(),
    outputSchema: toolOutputSchema,
    async invoke(_input, context) {
      adapterInvocations.set(
        context.executionId,
        (adapterInvocations.get(context.executionId) ?? 0) + 1,
      );
      if (fail) throw new Error('fixture adapter failure');
      return {
        artifactVersion: 'artifact-v1',
        operationId: context.operationId,
        executionId: context.executionId,
      };
    },
  };
}

const adapters = [
  adapter('localLookup', 'local'),
  adapter('teachingRetrieve', 'teaching'),
  adapter('mcpSearch', 'mcp'),
  adapter('nodeRead', 'node'),
  adapter('localFail', 'local', true),
  adapter('safeNoop', 'local', false, SAFE_CAPABILITY),
] as const;

function trustedContext(testCase: ToolEvalCase): ToolKernelTrustedContext {
  const dimensions = {
    actor: [CAPABILITY, SAFE_CAPABILITY],
    notebook: [CAPABILITY, SAFE_CAPABILITY],
    profile: [CAPABILITY, SAFE_CAPABILITY],
    channel: [CAPABILITY, SAFE_CAPABILITY],
    environment: [CAPABILITY, SAFE_CAPABILITY],
  } as const;
  return {
    operationId: OPERATION_ID,
    conversationId: 'conversation:agent-eval',
    traceId: 'trace:agent-eval',
    actorId: 'actor:fixture',
    agentId: 'agent:fixture',
    notebookId: 'notebook:fixture',
    profileId: 'profile:fixture',
    channel: 'eval',
    environment: 'test',
    answerModelRunId: 'model-run:fixture',
    providerToolCallId: `provider:${testCase.id}`,
    executionId: `execution:${testCase.id}`,
    capabilities: Object.fromEntries(
      Object.entries(dimensions).map(([name, values]) => [
        name,
        name === testCase.deniedDimension ? [SAFE_CAPABILITY] : values,
      ]),
    ) as ToolKernelTrustedContext['capabilities'],
    approvedCapabilities: [],
    credentialHandle: null,
  };
}

const terminalTypes = new Set(['completed', 'failed', 'tool.failed']);

async function runToolCase(testCase: ToolEvalCase) {
  const { callLedger, effectLedger } = memoryLedgers();
  const kernel = new ToolKernel(adapters, callLedger, effectLedger);
  let invocations = 0;
  const executionId = `execution:${testCase.id}`;
  adapterInvocations.delete(executionId);
  const gateway: TurnModelGateway = {
    async *streamTurnText(request) {
      if (request.toolResults.length === 0) {
        yield {
          type: 'tool_call',
          phase: request.phase,
          callId: `call_${testCase.id.replaceAll('.', '_').replaceAll('-', '_')}`,
          tool: testCase.requestedTool,
          argumentsDelta: JSON.stringify(testCase.arguments),
          done: true,
        };
        yield {
          type: 'completed',
          phase: request.phase,
          metadata: metadata(request, 'tool_calls'),
        };
        return;
      }
      yield { type: 'text_delta', phase: request.phase, delta: '完成。' };
      yield {
        type: 'completed',
        phase: request.phase,
        metadata: metadata(request, 'stop'),
      };
    },
  };
  const events: AgentLoopEvent<unknown, { code: string }>[] = [];
  for await (const event of new AgentLoopEngine(gateway).stream({
    traceId: 'trace:agent-eval',
    turnId: `turn:${testCase.id}`,
    maxToolRounds: 2,
    answer: {
      taskAlias: 'agent.turn',
      modelAlias: 'primary',
      promptVersion: 'agent-eval-v1',
      messages: [{ role: 'user', content: 'synthetic evaluation request' }],
      tools: kernel.listDefinitions(trustedContext(testCase)),
    },
    synthesis: {
      taskAlias: 'agent.turn',
      modelAlias: 'primary',
      promptVersion: 'agent-eval-v1',
      messages: [{ role: 'user', content: 'synthetic evaluation request' }],
    },
    async executeTools(calls) {
      const results = [];
      for (const call of calls) {
        invocations += 1;
        const result = await kernel.execute({
          tool: call.tool,
          arguments: call.arguments,
          context: trustedContext(testCase),
        });
        if (!result.ok)
          return { ok: false as const, failure: { code: result.code } };
        const output = toolOutputSchema.parse(result.output);
        if (
          output.operationId !== OPERATION_ID ||
          output.executionId !== executionId
        ) {
          return {
            ok: false as const,
            failure: { code: 'artifact_binding_mismatch' },
          };
        }
        results.push({
          call,
          modelResult: {
            callId: call.callId,
            tool: call.tool,
            arguments: call.arguments,
            output,
          },
          detail: { artifactVersion: output.artifactVersion },
        });
      }
      return { ok: true as const, results };
    },
  })) {
    events.push(event);
  }
  const terminals = events.filter((event) => terminalTypes.has(event.type));
  const terminal = terminals[0];
  const code =
    terminal?.type === 'tool.failed'
      ? terminal.failure.code
      : terminal?.type === 'failed'
        ? terminal.code
        : undefined;
  const adapterInvocationCount = adapterInvocations.get(executionId) ?? 0;
  const expectedAdapterInvocations =
    testCase.expectedTerminal === 'completed' ||
    testCase.expectedCode === 'tool_failed'
      ? 1
      : 0;
  return {
    id: testCase.id,
    passed:
      terminals.length === 1 &&
      terminal?.type === testCase.expectedTerminal &&
      code === testCase.expectedCode &&
      invocations === 1 &&
      adapterInvocationCount === expectedAdapterInvocations,
    terminal: terminal?.type ?? 'missing',
    code,
    invocations,
    adapterInvocations: adapterInvocationCount,
  };
}

async function collectRuntimeTerminal(
  behavior: 'abort' | 'timeout' | 'recover',
) {
  let calls = 0;
  const controller = new AbortController();
  if (behavior === 'abort') controller.abort();
  const gateway: TurnModelGateway = {
    async *streamTurnText(request) {
      calls += 1;
      if (behavior === 'abort') {
        const error = new Error('aborted fixture');
        error.name = 'AbortError';
        throw error;
      }
      if (behavior === 'timeout' || (behavior === 'recover' && calls === 1)) {
        throw new ModelGatewayInvocationError({
          code: 'timeout',
          retryable: behavior === 'recover',
        });
      }
      yield { type: 'text_delta', phase: request.phase, delta: '恢复。' };
      yield {
        type: 'completed',
        phase: request.phase,
        metadata: metadata(request, 'stop'),
      };
    },
  };
  const events = [];
  for await (const event of new AgentLoopEngine(gateway, {
    random: () => 0,
    async wait() {
      return true;
    },
  }).stream({
    traceId: 'trace:safety-eval',
    turnId: `turn:${behavior}`,
    maxToolRounds: 1,
    signal: controller.signal,
    answer: {
      taskAlias: 'teaching.turn',
      modelAlias: 'primary',
      promptVersion: 'safety-eval-v1',
      messages: [{ role: 'user', content: 'synthetic safety request' }],
      tools: [],
    },
    synthesis: {
      taskAlias: 'teaching.turn',
      modelAlias: 'primary',
      promptVersion: 'safety-eval-v1',
      messages: [{ role: 'user', content: 'synthetic safety request' }],
    },
    async executeTools() {
      return { ok: true as const, results: [] };
    },
  })) {
    events.push(event);
  }
  const terminals = events.filter((event) => terminalTypes.has(event.type));
  const terminal = terminals[0];
  return {
    terminal:
      terminal?.type === 'failed'
        ? terminal.code
        : terminal?.type === 'completed'
          ? 'completed'
          : (terminal?.type ?? 'missing'),
    terminalCount: terminals.length,
  };
}

async function runTeachingCase(testCase: TeachingSafetyEvalCase) {
  let actual: string;
  if (testCase.kind === 'input') {
    actual = evaluateTeachingInput(testCase.input).decision.policyCode;
  } else if (testCase.kind === 'output') {
    const gate = new TeachingOutputSafetyGate();
    let policyCode = 'k12_allowed';
    for (const chunk of testCase.chunks) {
      const result = gate.push(chunk);
      if (result.kind === 'blocked') policyCode = result.decision.policyCode;
    }
    if (!gate.isClosed) policyCode = gate.finish().decision.policyCode;
    actual = policyCode;
  } else if (testCase.kind === 'profile') {
    const policy = resolveLearnerAdaptationPolicy({
      ageBand: testCase.ageBand,
      gradeBand: testCase.gradeBand,
      declarationSource: 'school_asserted',
      preferences: defaultTeachingPreferences,
    });
    actual = `${policy.gradeBand}:${policy.minorSafetyRequired}`;
  } else {
    const runtime = await collectRuntimeTerminal(testCase.behavior);
    actual = `${runtime.terminal}:${runtime.terminalCount}`;
  }
  const expected =
    testCase.kind === 'profile'
      ? `${testCase.gradeBand}:${testCase.expectedMinorSafety}`
      : testCase.kind === 'runtime'
        ? `${testCase.expectedTerminal}:1`
        : testCase.expectedPolicyCode;
  return {
    id: testCase.id,
    critical: testCase.critical,
    passed: actual === expected,
    outcome: actual,
    expected,
  };
}

describe('deterministic Agent product evaluation', () => {
  it('scores Tool/Artifact and Teaching Safety v1 without provider access', async () => {
    expect(TOOL_ARTIFACT_CASES.length).toBeGreaterThanOrEqual(12);
    expect(TEACHING_SAFETY_CASES.length).toBeGreaterThanOrEqual(20);

    const toolArtifact = [];
    for (const testCase of TOOL_ARTIFACT_CASES) {
      toolArtifact.push(await runToolCase(testCase));
    }
    const teachingSafety = [];
    for (const testCase of TEACHING_SAFETY_CASES) {
      teachingSafety.push(await runTeachingCase(testCase));
    }
    const criticalSafety = teachingSafety.filter((entry) => entry.critical);
    const nonCriticalSafety = teachingSafety.filter((entry) => !entry.critical);
    const report = {
      schemaVersion: 1,
      datasetVersion: AGENT_EVAL_DATASET_VERSION,
      scope: 'synthetic deterministic runtime and policy fixtures',
      toolArtifact,
      teachingSafety,
      summary: {
        toolArtifact: {
          passed: toolArtifact.filter((entry) => entry.passed).length,
          total: toolArtifact.length,
        },
        teachingSafetyCritical: {
          passed: criticalSafety.filter((entry) => entry.passed).length,
          total: criticalSafety.length,
        },
        teachingSafetyNonCritical: {
          average:
            nonCriticalSafety.filter((entry) => entry.passed).length /
            nonCriticalSafety.length,
          total: nonCriticalSafety.length,
        },
      },
    };
    const reportsDirectory = fileURLToPath(
      new URL('../reports', import.meta.url),
    );
    mkdirSync(reportsDirectory, { recursive: true });
    writeFileSync(
      `${reportsDirectory}/agent-eval-${AGENT_EVAL_DATASET_VERSION}.json`,
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );

    expect(toolArtifact.filter((entry) => !entry.passed)).toEqual([]);
    expect(teachingSafety.filter((entry) => !entry.passed)).toEqual([]);
  });
});
