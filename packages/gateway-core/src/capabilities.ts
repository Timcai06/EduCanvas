import { z } from 'zod';
import {
  gatewayJsonValueSchema,
  gatewayOpaqueIdSchema,
  gatewayTimestampSchema,
} from './common';

export const gatewayRiskLevels = ['l0', 'l1', 'l2', 'l3'] as const;
export const gatewayRiskLevelSchema = z.enum(gatewayRiskLevels);
export type GatewayRiskLevel = z.infer<typeof gatewayRiskLevelSchema>;

export const gatewayCapabilityNames = [
  'input.text',
  'input.image',
  'input.file',
  'input.audio',
  'output.markdown',
  'output.image',
  'output.file',
  'output.audio',
  'output.card',
  'output.action',
  'output.stream',
  'artifact.native',
  'approval.interactive',
  'device.status',
  'filesystem.read_allowlisted',
] as const;
export const gatewayCapabilityNameSchema = z.enum(gatewayCapabilityNames);
export type GatewayCapabilityName = z.infer<typeof gatewayCapabilityNameSchema>;

export const gatewayCapabilitySchema = z
  .object({
    name: gatewayCapabilityNameSchema,
    risk: gatewayRiskLevelSchema,
    version: z.string().min(1).max(32),
    constraints: z.record(z.string(), gatewayJsonValueSchema).default({}),
  })
  .strict();

export type GatewayCapability = z.infer<typeof gatewayCapabilitySchema>;

export const gatewayCapabilityManifestSchema = z
  .object({
    manifestId: gatewayOpaqueIdSchema,
    issuedAt: gatewayTimestampSchema,
    capabilities: z.array(gatewayCapabilitySchema).max(64),
  })
  .strict()
  .superRefine((manifest, context) => {
    const names = manifest.capabilities.map((capability) => capability.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: 'custom',
        path: ['capabilities'],
        message: 'Capability names must be unique within a manifest',
      });
    }
  });

export type GatewayCapabilityManifest = z.infer<
  typeof gatewayCapabilityManifestSchema
>;

export const gatewayApprovalStatuses = [
  'pending',
  'approved',
  'denied',
  'expired',
  'revoked',
] as const;
export const gatewayApprovalStatusSchema = z.enum(gatewayApprovalStatuses);

export const gatewayApprovalRequestSchema = z
  .object({
    approvalId: gatewayOpaqueIdSchema,
    operationId: gatewayOpaqueIdSchema,
    actorUserId: gatewayOpaqueIdSchema,
    capability: gatewayCapabilityNameSchema,
    risk: gatewayRiskLevelSchema.refine(
      (risk) => risk === 'l2' || risk === 'l3',
      'Only L2/L3 capabilities use explicit approval',
    ),
    summary: z.string().trim().min(1).max(500),
    requestedAt: gatewayTimestampSchema,
    expiresAt: gatewayTimestampSchema,
  })
  .strict()
  .refine((request) => request.expiresAt > request.requestedAt, {
    path: ['expiresAt'],
    message: 'Approval request must expire after request time',
  });

export const gatewayApprovalDecisionSchema = z
  .object({
    approvalId: gatewayOpaqueIdSchema,
    status: gatewayApprovalStatusSchema.exclude(['pending']),
    decidedByUserId: gatewayOpaqueIdSchema,
    decidedAt: gatewayTimestampSchema,
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type GatewayApprovalRequest = z.infer<
  typeof gatewayApprovalRequestSchema
>;
export type GatewayApprovalDecision = z.infer<
  typeof gatewayApprovalDecisionSchema
>;
