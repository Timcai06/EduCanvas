import { z } from 'zod';
import { agentMessageInputSchema } from './message-contracts';

export const turnApplicationProtocolVersion = 'educanvas.turn.v2' as const;

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const capabilityNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_.-]*$/);

const publicHttpUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    const schemeSeparator = value.indexOf('://');
    const authority = value.slice(schemeSeparator + 3).split(/[/?#]/, 1)[0];
    return /^https?:\/\//i.test(value) && !authority?.includes('@');
  }, '引用URL必须是不含凭据的HTTP(S)地址');

/**
 * 入口提交给唯一 Turn Application 的可信命令。
 * actor/agent/notebook/conversation 必须由服务端路由解析，客户端不能直接构造。
 */
export const turnApplicationCommandSchema = z
  .object({
    protocol: z.literal(turnApplicationProtocolVersion),
    operationId: opaqueIdSchema,
    traceId: opaqueIdSchema,
    actor: z
      .object({
        actorId: opaqueIdSchema,
        agentId: opaqueIdSchema,
      })
      .strict(),
    notebook: z
      .object({
        notebookId: opaqueIdSchema,
        conversationId: opaqueIdSchema,
      })
      .strict(),
    profile: z
      .object({
        profileId: capabilityNameSchema,
      })
      .strict(),
    entrypoint: z.enum(['web', 'tui', 'channel', 'system']),
    input: agentMessageInputSchema,
    capabilities: z.array(capabilityNameSchema).max(128),
  })
  .strict()
  .superRefine((command, context) => {
    if (new Set(command.capabilities).size !== command.capabilities.length) {
      context.addIssue({
        code: 'custom',
        path: ['capabilities'],
        message: '能力清单不能包含重复项',
      });
    }
  });

export type TurnApplicationCommand = z.infer<
  typeof turnApplicationCommandSchema
>;

export const turnApplicationFailureCodes = [
  'INVALID_REQUEST',
  'FORBIDDEN',
  'IDEMPOTENCY_CONFLICT',
  'RATE_LIMITED',
  'CAPABILITY_UNAVAILABLE',
  'APPROVAL_REQUIRED',
  'APPROVAL_DENIED',
  'MODEL_FAILED',
  'TOOL_FAILED',
  'RUNTIME_FAILED',
  'CANCELLED',
] as const;

export const turnApplicationFailureCodeSchema = z.enum(
  turnApplicationFailureCodes,
);
export type TurnApplicationFailureCode = z.infer<
  typeof turnApplicationFailureCodeSchema
>;

const eventBase = {
  protocol: z.literal(turnApplicationProtocolVersion),
  operationId: opaqueIdSchema,
};

const citationTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('knowledge'),
      sourceId: opaqueIdSchema,
      documentId: opaqueIdSchema,
      chunkId: opaqueIdSchema,
      pageStart: z.number().int().positive().max(100_000).nullable(),
      pageEnd: z.number().int().positive().max(100_000).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('web'),
      assetId: opaqueIdSchema,
      assetVersionId: opaqueIdSchema,
      url: publicHttpUrlSchema,
    })
    .strict(),
]);

/**
 * Turn Application 的 transport-neutral 输出；Web SSE 与 Gateway NDJSON
 * 只能投影这些事件，不能从供应商分片或 UI 状态另造运行终态。
 */
export const turnApplicationEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...eventBase,
      type: z.literal('turn.started'),
      userMessageId: opaqueIdSchema,
      assistantMessageId: opaqueIdSchema,
      replayed: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('message.delta'),
      messageId: opaqueIdSchema,
      delta: z.string().min(1).max(16_000),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('message.citation'),
      messageId: opaqueIdSchema,
      citationId: opaqueIdSchema,
      marker: z.number().int().min(1).max(99).optional(),
      label: z.string().trim().min(1).max(160),
      target: citationTargetSchema,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('tool.started'),
      toolCallId: opaqueIdSchema,
      tool: capabilityNameSchema,
      label: z.string().trim().min(1).max(160).optional(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('tool.completed'),
      toolCallId: opaqueIdSchema,
      summary: z.string().trim().min(1).max(1_000).optional(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('tool.failed'),
      toolCallId: opaqueIdSchema,
      code: turnApplicationFailureCodeSchema,
      retryable: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('approval.required'),
      approvalId: opaqueIdSchema,
      capability: capabilityNameSchema,
      risk: z.enum(['l0', 'l1', 'l2', 'l3']),
      summary: z.string().trim().min(1).max(500),
      expiresAt: z.iso.datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('artifact.proposed'),
      artifactId: opaqueIdSchema,
      artifactKind: capabilityNameSchema,
      trustTier: z.enum(['tier1', 'tier2']),
      title: z.string().trim().min(1).max(300),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('artifact.version_added'),
      artifactId: opaqueIdSchema,
      versionId: opaqueIdSchema,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('artifact.generation_progress'),
      artifactId: opaqueIdSchema,
      jobId: opaqueIdSchema,
      progress: z.number().finite().min(0).max(1),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('artifact.failed'),
      artifactId: opaqueIdSchema,
      jobId: opaqueIdSchema.nullable(),
      code: turnApplicationFailureCodeSchema,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('turn.completed'),
      messageId: opaqueIdSchema,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('turn.failed'),
      messageId: opaqueIdSchema,
      code: turnApplicationFailureCodeSchema,
      retryable: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('turn.cancelled'),
      messageId: opaqueIdSchema,
    })
    .strict(),
]);

export type TurnApplicationEvent = z.infer<typeof turnApplicationEventSchema>;

export function isTurnApplicationTerminalEvent(
  event: TurnApplicationEvent,
): boolean {
  return (
    event.type === 'turn.completed' ||
    event.type === 'turn.failed' ||
    event.type === 'turn.cancelled'
  );
}

/**
 * 校验一个 Turn 的应用事件前缀。允许运行中的无终态前缀；一旦出现终态，
 * 终态必须是最后一项。首项必须绑定消息，后续事件必须属于同一 Operation。
 */
export function validateTurnApplicationEventSequence(
  events: readonly TurnApplicationEvent[],
): boolean {
  if (events.length === 0) return true;
  if (events[0]?.type !== 'turn.started') return false;
  const operationId = events[0].operationId;
  let terminalSeen = false;
  let startedCount = 0;
  for (const event of events) {
    if (event.operationId !== operationId || terminalSeen) return false;
    if (event.type === 'turn.started') startedCount += 1;
    terminalSeen = isTurnApplicationTerminalEvent(event);
  }
  return startedCount === 1;
}
