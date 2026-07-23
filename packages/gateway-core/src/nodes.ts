import { z } from 'zod';
import {
  gatewayJsonValueSchema,
  gatewayOpaqueIdSchema,
  gatewayTimestampSchema,
} from './common';
import {
  gatewayCapabilityManifestSchema,
  gatewayCapabilityNameSchema,
} from './capabilities';

export const gatewayNodeStatuses = [
  'pending',
  'active',
  'offline',
  'revoked',
] as const;
export const gatewayNodeStatusSchema = z.enum(gatewayNodeStatuses);

export const gatewayNodePairingRequestSchema = z
  .object({
    pairingRequestId: gatewayOpaqueIdSchema,
    displayName: z.string().trim().min(1).max(120),
    devicePublicKey: z.string().min(32).max(8_192),
    nonce: gatewayOpaqueIdSchema,
    requestedCapabilities: gatewayCapabilityManifestSchema,
    requestedAt: gatewayTimestampSchema,
    expiresAt: gatewayTimestampSchema,
  })
  .strict()
  .refine((request) => request.expiresAt > request.requestedAt, {
    path: ['expiresAt'],
    message: 'Pairing request must expire after request time',
  });

export const gatewayNodePairingRecordSchema = z
  .object({
    pairingId: gatewayOpaqueIdSchema,
    nodeId: gatewayOpaqueIdSchema,
    userId: gatewayOpaqueIdSchema,
    agentId: gatewayOpaqueIdSchema,
    displayName: z.string().trim().min(1).max(120),
    devicePublicKey: z.string().min(32).max(8_192),
    approvedCapabilities: gatewayCapabilityManifestSchema,
    status: gatewayNodeStatusSchema,
    pairedAt: gatewayTimestampSchema,
    lastSeenAt: gatewayTimestampSchema.nullable(),
    revokedAt: gatewayTimestampSchema.nullable(),
  })
  .strict();

export const gatewayNodeHeartbeatSchema = z
  .object({
    nodeId: gatewayOpaqueIdSchema,
    sessionId: gatewayOpaqueIdSchema,
    sequence: z.number().int().nonnegative(),
    occurredAt: gatewayTimestampSchema,
    capabilities: gatewayCapabilityManifestSchema,
  })
  .strict();

export const gatewayNodeInvocationRequestSchema = z
  .object({
    requestId: gatewayOpaqueIdSchema,
    operationId: gatewayOpaqueIdSchema,
    nodeId: gatewayOpaqueIdSchema,
    capability: gatewayCapabilityNameSchema.refine(
      (capability) =>
        capability === 'device.status' ||
        capability === 'filesystem.read_allowlisted',
      'Capability is not invokable on a Node',
    ),
    parameters: gatewayJsonValueSchema,
    nonce: gatewayOpaqueIdSchema,
    issuedAt: gatewayTimestampSchema,
    expiresAt: gatewayTimestampSchema,
  })
  .strict()
  .refine((request) => request.expiresAt > request.issuedAt, {
    path: ['expiresAt'],
    message: 'Node request must expire after issue time',
  });

export const gatewayNodeInvocationResultSchema = z.discriminatedUnion(
  'status',
  [
    z
      .object({
        requestId: gatewayOpaqueIdSchema,
        nodeId: gatewayOpaqueIdSchema,
        status: z.literal('completed'),
        completedAt: gatewayTimestampSchema,
        output: gatewayJsonValueSchema,
      })
      .strict(),
    z
      .object({
        requestId: gatewayOpaqueIdSchema,
        nodeId: gatewayOpaqueIdSchema,
        status: z.enum(['failed', 'rejected']),
        completedAt: gatewayTimestampSchema,
        code: z.enum([
          'CAPABILITY_NOT_ALLOWED',
          'REQUEST_EXPIRED',
          'REQUEST_REPLAYED',
          'INVALID_PARAMETERS',
          'PATH_NOT_ALLOWED',
          'NODE_REVOKED',
          'EXECUTION_FAILED',
        ]),
        retryable: z.boolean(),
      })
      .strict(),
  ],
);

export type GatewayNodePairingRequest = z.infer<
  typeof gatewayNodePairingRequestSchema
>;
export type GatewayNodePairingRecord = z.infer<
  typeof gatewayNodePairingRecordSchema
>;
export type GatewayNodeInvocationRequest = z.infer<
  typeof gatewayNodeInvocationRequestSchema
>;
export type GatewayNodeInvocationResult = z.infer<
  typeof gatewayNodeInvocationResultSchema
>;
