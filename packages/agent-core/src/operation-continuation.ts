import { z } from 'zod';
import { w3cTraceCarrierSchema } from './trace-carrier';

/** Operation continuation持久行与worker payload共同使用的协议版本。 */
export const operationContinuationProtocolVersion =
  'educanvas.operation-continuation.v1' as const;

/** Adapter耐久准备与Gateway原子绑定之间的最小意图协议。 */
export const toolApprovalIntentProtocolVersion =
  'educanvas.tool-approval-intent.v1' as const;

/** Graphile Worker注册与Gateway原子入队共用的任务名，禁止调用方散写。 */
export const OPERATION_CONTINUATION_TASK = 'operation:continue' as const;

/** 允许持久化的continuation生命周期状态。 */
export const operationContinuationStatuses = [
  'waiting_approval',
  'ready',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export const operationContinuationStatusSchema = z.enum(
  operationContinuationStatuses,
);
export type OperationContinuationStatus = z.infer<
  typeof operationContinuationStatusSchema
>;
export type OperationContinuationTerminalStatus = Extract<
  OperationContinuationStatus,
  'completed' | 'failed'
>;

/** 当前可提供耐久恢复引用的Adapter类别；不是客户端可声明的授权。 */
export const operationContinuationAdapterSources = [
  'local',
  'teaching',
  'mcp',
  'node',
] as const;
export const operationContinuationAdapterSourceSchema = z.enum(
  operationContinuationAdapterSources,
);
export type OperationContinuationAdapterSource = z.infer<
  typeof operationContinuationAdapterSourceSchema
>;

/** lease下限避免异常worker用高频领取制造数据库热循环。 */
export const MIN_OPERATION_CONTINUATION_LEASE_MS = 5_000;
/** lease上限限制进程崩溃后等待重领的最长业务窗口。 */
export const MAX_OPERATION_CONTINUATION_LEASE_MS = 15 * 60_000;

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const failureCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9._:-]*$/);

/**
 * 当前唯一可持久恢复的工作引用。resumeRef必须指向Adapter自己拥有的耐久意图，
 * 不能内嵌工具参数、Prompt、正文、Credential、Secret或外部响应。
 */
export const operationContinuationWorkSchema = z
  .object({
    kind: z.literal('tool_invocation'),
    step: z.literal('tool.invoke'),
    toolCallId: opaqueIdSchema,
    adapterSource: operationContinuationAdapterSourceSchema,
    resumeRef: opaqueIdSchema,
  })
  .strict();
export type OperationContinuationWork = z.infer<
  typeof operationContinuationWorkSchema
>;

/** 创建等待点时的严格输入；额外字段会被拒绝而不是进入checkpoint。 */
export const createOperationContinuationInputSchema = z
  .object({
    operationId: opaqueIdSchema,
    actorId: opaqueIdSchema,
    approvalId: opaqueIdSchema,
    work: operationContinuationWorkSchema,
    traceCarrier: w3cTraceCarrierSchema.nullable().default(null),
  })
  .strict();
export type CreateOperationContinuationInput = z.input<
  typeof createOperationContinuationInputSchema
>;

export const toolApprovalIntentStatuses = [
  'prepared',
  'bound',
  'abandoned',
] as const;
export const toolApprovalIntentStatusSchema = z.enum(
  toolApprovalIntentStatuses,
);
export type ToolApprovalIntentStatus = z.infer<
  typeof toolApprovalIntentStatusSchema
>;

/**
 * Adapter只能准备稳定恢复引用；参数、Prompt、正文、Credential、Secret与结果均无字段可写。
 * expiresAt与公开审批共用，Gateway绑定时必须逐值核对。
 */
export const prepareToolApprovalIntentInputSchema = z
  .object({
    operationId: opaqueIdSchema,
    actorId: opaqueIdSchema,
    approvalId: opaqueIdSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    work: operationContinuationWorkSchema,
    traceCarrier: w3cTraceCarrierSchema.nullable().default(null),
  })
  .strict();
export type PrepareToolApprovalIntentInput = z.input<
  typeof prepareToolApprovalIntentInputSchema
>;

export const toolApprovalIntentSnapshotSchema = z
  .object({
    protocol: z.literal(toolApprovalIntentProtocolVersion),
    operationId: opaqueIdSchema,
    actorId: opaqueIdSchema,
    approvalId: opaqueIdSchema,
    status: toolApprovalIntentStatusSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    work: operationContinuationWorkSchema,
    traceCarrier: w3cTraceCarrierSchema.nullable().default(null),
    preparedAt: z.iso.datetime({ offset: true }),
    boundAt: z.iso.datetime({ offset: true }).nullable(),
    abandonedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const bound = snapshot.status === 'bound';
    const abandoned = snapshot.status === 'abandoned';
    if (bound !== (snapshot.boundAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['boundAt'],
        message: '只有bound意图必须记录绑定时间',
      });
    }
    if (abandoned !== (snapshot.abandonedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['abandonedAt'],
        message: '只有abandoned意图必须记录放弃时间',
      });
    }
  });
export type ToolApprovalIntentSnapshot = z.infer<
  typeof toolApprovalIntentSnapshotSchema
>;

/** Adapter准备审批时使用；绑定Approval与continuation仍由Gateway Operation Store独占。 */
export interface ToolApprovalIntentPort {
  prepare(input: PrepareToolApprovalIntentInput): Promise<{
    intent: ToolApprovalIntentSnapshot;
    replayed: boolean;
  }>;
}

/** 只包含控制状态与稳定引用的恢复快照；身份、授权、审批与副作用结果均不是本表事实。 */
export const operationContinuationSnapshotSchema = z
  .object({
    protocol: z.literal(operationContinuationProtocolVersion),
    continuationId: opaqueIdSchema,
    operationId: opaqueIdSchema,
    sequence: z.number().int().min(1).max(1_000),
    status: operationContinuationStatusSchema,
    approvalId: opaqueIdSchema,
    work: operationContinuationWorkSchema,
    traceCarrier: w3cTraceCarrierSchema.nullable().default(null),
    leaseGeneration: z.number().int().min(0).max(1_000_000),
    leaseOwnerId: opaqueIdSchema.nullable(),
    leaseExpiresAt: z.iso.datetime({ offset: true }).nullable(),
    heartbeatAt: z.iso.datetime({ offset: true }).nullable(),
    failureCode: failureCodeSchema.nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const running = snapshot.status === 'running';
    const hasCompleteLease =
      snapshot.leaseOwnerId !== null &&
      snapshot.leaseExpiresAt !== null &&
      snapshot.heartbeatAt !== null &&
      snapshot.leaseGeneration >= 1;
    if (running !== hasCompleteLease) {
      context.addIssue({
        code: 'custom',
        path: ['leaseOwnerId'],
        message: '只有running continuation必须持有完整lease',
      });
    }
    if (
      !running &&
      (snapshot.leaseOwnerId !== null ||
        snapshot.leaseExpiresAt !== null ||
        snapshot.heartbeatAt !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['leaseOwnerId'],
        message: '非running continuation不能保留lease',
      });
    }
    const terminal = ['completed', 'failed', 'cancelled'].includes(
      snapshot.status,
    );
    if (terminal !== (snapshot.completedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'continuation终态与完成时间必须一致',
      });
    }
    if ((snapshot.status === 'failed') !== (snapshot.failureCode !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: '只有failed continuation必须记录稳定失败码',
      });
    }
  });
export type OperationContinuationSnapshot = z.infer<
  typeof operationContinuationSnapshotSchema
>;

/**
 * 耐久Operation恢复Port。每次调用都必须重新验证Actor与当前Operation归属；
 * claim只授予执行租约，不能据此跳过Membership、approval或Tool授权重算。
 */
export interface OperationContinuationPort {
  createWaiting(input: CreateOperationContinuationInput): Promise<{
    continuation: OperationContinuationSnapshot;
    replayed: boolean;
  }>;
  get(input: {
    continuationId: string;
    actorId: string;
  }): Promise<OperationContinuationSnapshot | null>;
  getActive(input: {
    operationId: string;
    actorId: string;
  }): Promise<OperationContinuationSnapshot | null>;
  markReady(input: {
    continuationId: string;
    actorId: string;
    approvalId: string;
  }): Promise<{
    continuation: OperationContinuationSnapshot;
    transitioned: boolean;
  }>;
  claim(input: {
    continuationId: string;
    actorId: string;
    ownerId: string;
    leaseDurationMs: number;
  }): Promise<OperationContinuationSnapshot | null>;
  heartbeat(input: {
    continuationId: string;
    actorId: string;
    ownerId: string;
    leaseGeneration: number;
    leaseDurationMs: number;
  }): Promise<boolean>;
  release(input: {
    continuationId: string;
    actorId: string;
    ownerId: string;
    leaseGeneration: number;
  }): Promise<{
    continuation: OperationContinuationSnapshot;
    transitioned: boolean;
  }>;
  settle(input: {
    continuationId: string;
    actorId: string;
    ownerId: string;
    leaseGeneration: number;
    status: OperationContinuationTerminalStatus;
    failureCode?: string | null;
  }): Promise<{
    continuation: OperationContinuationSnapshot;
    transitioned: boolean;
  }>;
  cancel(input: { operationId: string; actorId: string }): Promise<{
    continuation: OperationContinuationSnapshot;
    transitioned: boolean;
  }>;
}
