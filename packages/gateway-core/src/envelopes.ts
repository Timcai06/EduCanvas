import {
  agentArtifactPartSchema,
  agentAssetPartSchema,
  agentTextPartSchema,
} from '@educanvas/agent-core';
import { z } from 'zod';
import {
  gatewayIdempotencyKeySchema,
  gatewayOpaqueIdSchema,
  gatewayProtocolVersionSchema,
  gatewayTimestampSchema,
} from './common';
import { gatewayCapabilityManifestSchema } from './capabilities';
import { gatewayCitationSchema } from './citations';
import { gatewayConnectionSchema, gatewayPrincipalSchema } from './identity';
import { gatewayRouteHintSchema } from './routing';

export const gatewayExternalMediaKinds = [
  'image',
  'audio',
  'video',
  'file',
] as const;
export const gatewayExternalMediaKindSchema = z.enum(gatewayExternalMediaKinds);

/** Adapter-local media handle. It never contains a provider URL or credential. */
export const gatewayExternalMediaPartSchema = z
  .object({
    type: z.literal('external_media'),
    mediaId: gatewayOpaqueIdSchema,
    kind: gatewayExternalMediaKindSchema,
    mimeType: z.string().min(3).max(160),
    fileName: z.string().min(1).max(255).optional(),
    sizeBytes: z.number().int().nonnegative().max(100_000_000).optional(),
  })
  .strict();

export const gatewayActionPartSchema = z
  .object({
    type: z.literal('action'),
    actionId: gatewayOpaqueIdSchema,
    value: z.string().min(1).max(4_000),
  })
  .strict();

export const gatewayInboundPartSchema = z.discriminatedUnion('type', [
  agentTextPartSchema,
  agentAssetPartSchema,
  agentArtifactPartSchema,
  gatewayExternalMediaPartSchema,
  gatewayActionPartSchema,
]);

export type GatewayInboundPart = z.infer<typeof gatewayInboundPartSchema>;

export const gatewayReplyTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('connection'),
      connectionId: gatewayOpaqueIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('channel'),
      adapterId: gatewayOpaqueIdSchema,
      accountId: gatewayOpaqueIdSchema,
      threadId: gatewayOpaqueIdSchema,
    })
    .strict(),
]);

/**
 * Authenticated normalized input. Only Gateway authentication/adapters may create
 * this envelope; public HTTP bodies use transport-specific untrusted schemas.
 */
export const gatewayInboundEnvelopeSchema = z
  .object({
    protocol: gatewayProtocolVersionSchema,
    envelopeId: gatewayOpaqueIdSchema,
    idempotencyKey: gatewayIdempotencyKeySchema,
    occurredAt: gatewayTimestampSchema,
    connection: gatewayConnectionSchema,
    principal: gatewayPrincipalSchema,
    routeHint: gatewayRouteHintSchema,
    parts: z.array(gatewayInboundPartSchema).min(1).max(32),
    capabilities: gatewayCapabilityManifestSchema,
    replyTarget: gatewayReplyTargetSchema,
  })
  .strict();

export type GatewayInboundEnvelope = z.infer<
  typeof gatewayInboundEnvelopeSchema
>;

/** Public clients send this untrusted shape; Gateway injects principal/connection. */
export const gatewayClientTurnRequestSchema = z
  .object({
    clientMessageId: gatewayIdempotencyKeySchema,
    notebookId: gatewayOpaqueIdSchema,
    conversationId: gatewayOpaqueIdSchema,
    parts: z.array(gatewayInboundPartSchema).min(1).max(32),
  })
  .strict();

export type GatewayClientTurnRequest = z.infer<
  typeof gatewayClientTurnRequestSchema
>;

export const gatewayOutboundPartSchema = z.discriminatedUnion('type', [
  agentTextPartSchema,
  agentAssetPartSchema,
  agentArtifactPartSchema,
  z
    .object({
      type: z.literal('web_link'),
      label: z.string().trim().min(1).max(120),
      path: z
        .string()
        .min(1)
        .max(2_000)
        .refine(
          (value) => value.startsWith('/'),
          'Only relative Web paths allowed',
        ),
    })
    .strict(),
  z
    .object({
      type: z.literal('action'),
      actionId: gatewayOpaqueIdSchema,
      label: z.string().trim().min(1).max(120),
    })
    .strict(),
]);

export const gatewayOutboundEnvelopeSchema = z
  .object({
    protocol: gatewayProtocolVersionSchema,
    envelopeId: gatewayOpaqueIdSchema,
    operationId: gatewayOpaqueIdSchema,
    messageId: gatewayOpaqueIdSchema,
    occurredAt: gatewayTimestampSchema,
    target: gatewayReplyTargetSchema,
    parts: z.array(gatewayOutboundPartSchema).min(1).max(32),
    terminalState: z.enum(['ongoing', 'completed', 'failed', 'cancelled']),
    citations: z.array(gatewayCitationSchema).max(99).default([]),
    requiredAction: z
      .discriminatedUnion('kind', [
        z
          .object({
            kind: z.literal('approval'),
            approvalId: gatewayOpaqueIdSchema,
          })
          .strict(),
        z
          .object({
            kind: z.literal('choose_notebook'),
            requestId: gatewayOpaqueIdSchema,
          })
          .strict(),
        z
          .object({
            kind: z.literal('reauthenticate'),
            reason: z.enum(['expired', 'revoked', 'insufficient_assurance']),
          })
          .strict(),
      ])
      .nullable()
      .default(null),
  })
  .strict();

export type GatewayOutboundEnvelope = z.infer<
  typeof gatewayOutboundEnvelopeSchema
>;
