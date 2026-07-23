import { z } from 'zod';
import {
  gatewayJsonValueSchema,
  gatewayOpaqueIdSchema,
  gatewayProtocolVersionSchema,
  gatewayTimestampSchema,
} from './common';
import {
  gatewayApprovalDecisionSchema,
  gatewayApprovalRequestSchema,
} from './capabilities';
import { gatewayCitationSchema } from './citations';

export const gatewayFailureCodes = [
  'INVALID_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'ROUTE_NOT_FOUND',
  'IDEMPOTENCY_CONFLICT',
  'RATE_LIMITED',
  'POLICY_BLOCKED',
  'CAPABILITY_UNAVAILABLE',
  'APPROVAL_REQUIRED',
  'APPROVAL_DENIED',
  'RUNTIME_FAILED',
  'DELIVERY_FAILED',
  'CANCELLED',
  'INTERNAL_ERROR',
] as const;
export const gatewayFailureCodeSchema = z.enum(gatewayFailureCodes);
export type GatewayFailureCode = z.infer<typeof gatewayFailureCodeSchema>;

const eventBase = {
  protocol: gatewayProtocolVersionSchema,
  eventId: gatewayOpaqueIdSchema,
  operationId: gatewayOpaqueIdSchema,
  sequence: z.number().int().nonnegative(),
  occurredAt: gatewayTimestampSchema,
};

export const gatewayOperationEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('operation.accepted') }).strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('message.started'),
      userMessageId: gatewayOpaqueIdSchema,
      assistantMessageId: gatewayOpaqueIdSchema,
      replayed: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('message.delta'),
      delta: z.string().min(1).max(16_000),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('message.citation'),
      messageId: gatewayOpaqueIdSchema,
      citation: gatewayCitationSchema,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('tool.started'),
      toolCallId: gatewayOpaqueIdSchema,
      tool: gatewayOpaqueIdSchema,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('tool.failed'),
      toolCallId: gatewayOpaqueIdSchema,
      code: gatewayFailureCodeSchema,
      retryable: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('tool.completed'),
      toolCallId: gatewayOpaqueIdSchema,
      summary: gatewayJsonValueSchema,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('approval.required'),
      approval: gatewayApprovalRequestSchema,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('approval.resolved'),
      decision: gatewayApprovalDecisionSchema,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('artifact.proposed'),
      artifactId: gatewayOpaqueIdSchema,
      artifactKind: gatewayOpaqueIdSchema,
      title: z.string().trim().min(1).max(300),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('artifact.version_added'),
      artifactId: gatewayOpaqueIdSchema,
      versionId: gatewayOpaqueIdSchema,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('artifact.generation_progress'),
      artifactId: gatewayOpaqueIdSchema,
      jobId: gatewayOpaqueIdSchema,
      progress: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('artifact.failed'),
      artifactId: gatewayOpaqueIdSchema,
      jobId: gatewayOpaqueIdSchema.nullable(),
      code: gatewayFailureCodeSchema,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('operation.completed'),
      messageId: gatewayOpaqueIdSchema,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('operation.failed'),
      code: gatewayFailureCodeSchema,
      retryable: z.boolean(),
    })
    .strict(),
  z.object({ ...eventBase, type: z.literal('operation.cancelled') }).strict(),
]);

export type GatewayOperationEvent = z.infer<typeof gatewayOperationEventSchema>;

export const gatewayResumeCursorSchema = z
  .object({
    operationId: gatewayOpaqueIdSchema,
    afterSequence: z.number().int().min(-1),
  })
  .strict();

export type GatewayResumeCursor = z.infer<typeof gatewayResumeCursorSchema>;

export function isGatewayTerminalEvent(event: GatewayOperationEvent): boolean {
  return (
    event.type === 'operation.completed' ||
    event.type === 'operation.failed' ||
    event.type === 'operation.cancelled'
  );
}

export function validateGatewayEventSequence(
  events: readonly GatewayOperationEvent[],
): boolean {
  if (events.length === 0) return true;
  const operationId = events[0]?.operationId;
  let terminalSeen = false;
  let previousSequence = -1;
  for (const event of events) {
    if (
      event.operationId !== operationId ||
      event.sequence <= previousSequence ||
      terminalSeen
    ) {
      return false;
    }
    previousSequence = event.sequence;
    terminalSeen = isGatewayTerminalEvent(event);
  }
  return true;
}

export const gatewayEventBatchSchema = z
  .object({
    operationId: gatewayOpaqueIdSchema,
    events: z.array(gatewayOperationEventSchema).max(1_000),
    nextCursor: gatewayResumeCursorSchema,
  })
  .strict()
  .superRefine((batch, context) => {
    if (
      batch.events.some((event) => event.operationId !== batch.operationId) ||
      batch.nextCursor.operationId !== batch.operationId ||
      !validateGatewayEventSequence(batch.events)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'Event batch must contain one ordered operation stream',
      });
    }
    const last = batch.events.at(-1);
    if (
      last !== undefined &&
      batch.nextCursor.afterSequence !== last.sequence
    ) {
      context.addIssue({
        code: 'custom',
        path: ['nextCursor', 'afterSequence'],
        message: 'Cursor must point at the final event sequence',
      });
    }
  });

export type GatewayEventBatch = z.infer<typeof gatewayEventBatchSchema>;
