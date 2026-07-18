import type {
  ModelMessage,
  ProviderCallMetadata,
  StreamTurnTextRequest,
  StructuredModelGateway,
  StructuredModelRequest,
  StructuredModelResult,
  TurnModelGateway,
  TurnModelEvent,
} from '@educanvas/agent-core';
import { providerCallMetadataSchema } from '@educanvas/agent-core';

/** 测试替身自身的稳定失败码，不模拟任何模型供应商语义。 */
export const scriptedModelGatewayErrorCodes = [
  'INVALID_STEP',
  'SCRIPT_EXHAUSTED',
  'STEP_KIND_MISMATCH',
  'TASK_ALIAS_MISMATCH',
  'MODEL_ALIAS_MISMATCH',
  'PHASE_MISMATCH',
  'PROMPT_VERSION_MISMATCH',
  'OUTPUT_SCHEMA_MISMATCH',
  'UNCONSUMED_STEPS',
] as const;

export type ScriptedModelGatewayErrorCode =
  (typeof scriptedModelGatewayErrorCodes)[number];

/** 测试脚本配置或输出不符合约定时抛出的可断言错误。 */
export class ScriptedModelGatewayError extends Error {
  override readonly name = 'ScriptedModelGatewayError';

  constructor(
    readonly code: ScriptedModelGatewayErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** 结构化 Fixture 的默认审计元数据；调用相关字段会由请求覆盖。 */
export const defaultScriptedModelMetadata: Readonly<ProviderCallMetadata> =
  Object.freeze({
    providerResponseId: 'scripted-response',
    provider: 'scripted',
    taskAlias: 'artifact.generate',
    modelAlias: 'structured',
    resolvedModelId: 'scripted/model',
    modelRevision: 'scripted-v1',
    systemFingerprint: null,
    finishReason: 'stop',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheHitTokens: 0,
      reasoningTokens: 0,
    },
    latencyMs: 0,
    traceId: 'scripted-trace',
  });

interface ScriptedExpectation {
  readonly expectedTaskAlias?: string;
  readonly expectedModelAlias?: string;
  readonly expectedPromptVersion?: string;
}

/** 兼容旧结构化 Fixture 的步骤；不允许用于 teaching.turn。 */
export interface ScriptedStructuredModelStep extends ScriptedExpectation {
  readonly kind?: 'structured';
  readonly output?: unknown;
  readonly error?: unknown;
  readonly metadata?: Partial<ProviderCallMetadata>;
}

/** 正常 Turn 的确定性流式 Fixture。events 可含畸形值以验证 runtime 防御。 */
export interface ScriptedStreamModelStep extends ScriptedExpectation {
  readonly kind: 'stream';
  readonly expectedPhase?: StreamTurnTextRequest['phase'];
  readonly events?: readonly unknown[];
  readonly error?: unknown;
}

export type ScriptedModelStep =
  ScriptedStructuredModelStep | ScriptedStreamModelStep;

/** 捕获值与原请求隔离，防止后续可变引用改写断言证据。 */
export interface ScriptedStructuredRequestCapture {
  readonly kind: 'structured';
  readonly taskAlias: string;
  readonly modelAlias: string;
  readonly messages: readonly ModelMessage[];
  readonly promptVersion: string;
  readonly traceId: string;
  readonly operationId: string;
}

export interface ScriptedStreamRequestCapture {
  readonly kind: 'stream';
  readonly taskAlias: string;
  readonly modelAlias: string;
  readonly phase: StreamTurnTextRequest['phase'];
  readonly messages: readonly ModelMessage[];
  readonly tools: StreamTurnTextRequest['tools'];
  readonly toolResults: StreamTurnTextRequest['toolResults'];
  readonly promptVersion: string;
  readonly traceId: string;
  readonly turnId: string;
}

const cloneMessages = (messages: readonly ModelMessage[]) =>
  Object.freeze(messages.map((message) => Object.freeze({ ...message })));

function captureStructuredRequest<Output>(
  request: StructuredModelRequest<Output>,
): ScriptedStructuredRequestCapture {
  return Object.freeze({
    kind: 'structured',
    taskAlias: request.taskAlias,
    modelAlias: request.modelAlias,
    messages: cloneMessages(request.messages),
    promptVersion: request.promptVersion,
    traceId: request.traceId,
    operationId: request.operationId,
  });
}

function captureStreamRequest(
  request: StreamTurnTextRequest,
): ScriptedStreamRequestCapture {
  return Object.freeze({
    kind: 'stream',
    taskAlias: request.taskAlias,
    modelAlias: request.modelAlias,
    phase: request.phase,
    messages: cloneMessages(request.messages),
    tools: structuredClone(request.tools),
    toolResults: structuredClone(request.toolResults),
    promptVersion: request.promptVersion,
    traceId: request.traceId,
    turnId: request.turnId,
  });
}

function assertValidStep(step: ScriptedModelStep, index: number): void {
  const isStream = step.kind === 'stream';
  const hasResult = isStream
    ? Object.hasOwn(step, 'events')
    : Object.hasOwn(step, 'output');
  const hasError = Object.hasOwn(step, 'error');
  if (hasResult === hasError) {
    throw new ScriptedModelGatewayError(
      'INVALID_STEP',
      `脚本步骤${index}必须且只能设置结果或error`,
    );
  }
  if (!isStream && step.metadata !== undefined) {
    const metadata = providerCallMetadataSchema
      .partial()
      .safeParse(step.metadata);
    if (!metadata.success) {
      throw new ScriptedModelGatewayError(
        'INVALID_STEP',
        `脚本步骤${index}的metadata不合法`,
        { cause: metadata.error },
      );
    }
  }
}

function assertExpectations(
  step: ScriptedExpectation,
  request: {
    taskAlias: string;
    modelAlias: string;
    promptVersion: string;
  },
): void {
  if (
    step.expectedTaskAlias !== undefined &&
    step.expectedTaskAlias !== request.taskAlias
  ) {
    throw new ScriptedModelGatewayError(
      'TASK_ALIAS_MISMATCH',
      `期望任务别名${step.expectedTaskAlias}，实际为${request.taskAlias}`,
    );
  }
  if (
    step.expectedModelAlias !== undefined &&
    step.expectedModelAlias !== request.modelAlias
  ) {
    throw new ScriptedModelGatewayError(
      'MODEL_ALIAS_MISMATCH',
      `期望模型别名${step.expectedModelAlias}，实际为${request.modelAlias}`,
    );
  }
  if (
    step.expectedPromptVersion !== undefined &&
    step.expectedPromptVersion !== request.promptVersion
  ) {
    throw new ScriptedModelGatewayError(
      'PROMPT_VERSION_MISMATCH',
      `期望Prompt版本${step.expectedPromptVersion}，实际为${request.promptVersion}`,
    );
  }
}

/**
 * 对话流式与结构化 Port 的确定性测试替身。该类只位于 `src/testing`，不从包入口导出，
 * 不实现语音 Port，也不具备模型推理、路由或供应商行为，不得注册到生产组合根。
 */
export class ScriptedModelGateway
  implements TurnModelGateway, StructuredModelGateway
{
  private readonly steps: ScriptedModelStep[];
  private readonly structuredRequests: ScriptedStructuredRequestCapture[] = [];
  private readonly streamRequests: ScriptedStreamRequestCapture[] = [];

  constructor(steps: readonly ScriptedModelStep[]) {
    steps.forEach(assertValidStep);
    this.steps = [...steps];
  }

  get remainingStepCount(): number {
    return this.steps.length;
  }

  /** 旧测试兼容入口：仅返回结构化请求。 */
  getCapturedRequests(): readonly ScriptedStructuredRequestCapture[] {
    return Object.freeze([...this.structuredRequests]);
  }

  getCapturedStreamRequests(): readonly ScriptedStreamRequestCapture[] {
    return Object.freeze([...this.streamRequests]);
  }

  assertExhausted(): void {
    if (this.steps.length > 0) {
      throw new ScriptedModelGatewayError(
        'UNCONSUMED_STEPS',
        `仍有${this.steps.length}个脚本步骤未消费`,
      );
    }
  }

  async generateStructured<Output>(
    request: StructuredModelRequest<Output>,
  ): Promise<StructuredModelResult<Output>> {
    this.structuredRequests.push(captureStructuredRequest(request));
    const step = this.steps.shift();
    if (!step) {
      throw new ScriptedModelGatewayError(
        'SCRIPT_EXHAUSTED',
        `没有可供任务${request.taskAlias}消费的脚本步骤`,
      );
    }
    if (step.kind === 'stream') {
      throw new ScriptedModelGatewayError(
        'STEP_KIND_MISMATCH',
        '流式步骤不能用于generateStructured',
      );
    }
    assertExpectations(step, request);
    if ('error' in step) throw step.error;

    const parsedOutput = request.schema.safeParse(step.output);
    if (!parsedOutput.success) {
      throw new ScriptedModelGatewayError(
        'OUTPUT_SCHEMA_MISMATCH',
        `任务${request.taskAlias}的脚本输出未通过Schema校验`,
        { cause: parsedOutput.error },
      );
    }

    const metadata = providerCallMetadataSchema.parse({
      ...defaultScriptedModelMetadata,
      taskAlias: request.taskAlias,
      modelAlias: request.modelAlias,
      traceId: request.traceId,
      ...step.metadata,
    });
    return { output: parsedOutput.data, metadata };
  }

  async *streamTurnText(
    request: StreamTurnTextRequest,
  ): AsyncIterable<TurnModelEvent> {
    this.streamRequests.push(captureStreamRequest(request));
    const step = this.steps.shift();
    if (!step) {
      throw new ScriptedModelGatewayError(
        'SCRIPT_EXHAUSTED',
        `没有可供${request.phase}阶段消费的脚本步骤`,
      );
    }
    if (step.kind !== 'stream') {
      throw new ScriptedModelGatewayError(
        'STEP_KIND_MISMATCH',
        '结构化步骤不能用于streamTurnText',
      );
    }
    assertExpectations(step, request);
    if (
      step.expectedPhase !== undefined &&
      step.expectedPhase !== request.phase
    ) {
      throw new ScriptedModelGatewayError(
        'PHASE_MISMATCH',
        `期望阶段${step.expectedPhase}，实际为${request.phase}`,
      );
    }
    if ('error' in step) throw step.error;

    // 故意不在测试替身中校验事件，让 Orchestrator 契约测试可注入畸形流。
    for (const event of step.events ?? []) {
      yield event as TurnModelEvent;
    }
  }
}
