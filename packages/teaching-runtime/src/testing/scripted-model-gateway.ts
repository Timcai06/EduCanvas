import type {
  ModelGateway,
  ModelMessage,
  StructuredModelRequest,
  StructuredModelResult,
} from '@educanvas/teaching-core';
import { z } from 'zod';

/** ScriptedModelGateway自身的稳定失败码，不模拟具体模型供应商错误。 */
export const scriptedModelGatewayErrorCodes = [
  'INVALID_STEP',
  'SCRIPT_EXHAUSTED',
  'TASK_ALIAS_MISMATCH',
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

export type ScriptedModelMetadata = Omit<
  StructuredModelResult<never>,
  'output'
>;

/** 无真实网络调用时使用的确定性默认元数据。 */
export const defaultScriptedModelMetadata: Readonly<ScriptedModelMetadata> =
  Object.freeze({
    provider: 'scripted',
    modelRevision: 'scripted-v1',
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
  });

/**
 * 单个FIFO脚本步骤。error用于模拟调用失败；未设置error时output必须通过请求Schema。
 */
export interface ScriptedModelStep {
  readonly expectedTaskAlias?: string;
  readonly expectedPromptVersion?: string;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly metadata?: Partial<ScriptedModelMetadata>;
}

const scriptedMetadataSchema = z
  .object({
    provider: z.string().min(1),
    modelRevision: z.string().min(1),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    latencyMs: z.number().finite().nonnegative(),
  })
  .partial()
  .strict();

/** 捕获调用时只保留可审计字段，不向测试暴露可变的请求对象。 */
export interface ScriptedModelRequestCapture {
  readonly taskAlias: string;
  readonly messages: readonly ModelMessage[];
  readonly promptVersion: string;
  readonly traceId: string;
}

function captureRequest<Output>(
  request: StructuredModelRequest<Output>,
): ScriptedModelRequestCapture {
  return Object.freeze({
    taskAlias: request.taskAlias,
    messages: Object.freeze(
      request.messages.map((message) => Object.freeze({ ...message })),
    ),
    promptVersion: request.promptVersion,
    traceId: request.traceId,
  });
}

function assertValidStep(step: ScriptedModelStep, index: number): void {
  const hasOutput = Object.hasOwn(step, 'output');
  const hasError = Object.hasOwn(step, 'error');
  if (hasOutput === hasError) {
    throw new ScriptedModelGatewayError(
      'INVALID_STEP',
      `脚本步骤${index}必须且只能设置output或error`,
    );
  }
  const metadata = scriptedMetadataSchema.safeParse(step.metadata ?? {});
  if (!metadata.success) {
    throw new ScriptedModelGatewayError(
      'INVALID_STEP',
      `脚本步骤${index}的metadata不合法`,
      { cause: metadata.error },
    );
  }
}

/**
 * 完全确定性的ModelGateway测试替身：按FIFO消费步骤、验证调用契约并捕获请求。
 */
export class ScriptedModelGateway implements ModelGateway {
  private readonly steps: ScriptedModelStep[];
  private readonly capturedRequests: ScriptedModelRequestCapture[] = [];

  constructor(steps: readonly ScriptedModelStep[]) {
    steps.forEach(assertValidStep);
    this.steps = [...steps];
  }

  get remainingStepCount(): number {
    return this.steps.length;
  }

  getCapturedRequests(): readonly ScriptedModelRequestCapture[] {
    return Object.freeze([...this.capturedRequests]);
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
    this.capturedRequests.push(captureRequest(request));
    const step = this.steps.shift();
    if (!step) {
      throw new ScriptedModelGatewayError(
        'SCRIPT_EXHAUSTED',
        `没有可供任务${request.taskAlias}消费的脚本步骤`,
      );
    }

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
      step.expectedPromptVersion !== undefined &&
      step.expectedPromptVersion !== request.promptVersion
    ) {
      throw new ScriptedModelGatewayError(
        'PROMPT_VERSION_MISMATCH',
        `期望Prompt版本${step.expectedPromptVersion}，实际为${request.promptVersion}`,
      );
    }
    if ('error' in step) throw step.error;

    const parsedOutput = request.schema.safeParse(step.output);
    if (!parsedOutput.success) {
      throw new ScriptedModelGatewayError(
        'OUTPUT_SCHEMA_MISMATCH',
        `任务${request.taskAlias}的脚本输出未通过Schema校验`,
        { cause: parsedOutput.error },
      );
    }

    return {
      output: parsedOutput.data,
      ...defaultScriptedModelMetadata,
      ...step.metadata,
    };
  }
}
