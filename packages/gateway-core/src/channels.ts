import { z } from 'zod';
import { gatewayOpaqueIdSchema, gatewayTimestampSchema } from './common';

export const gatewayChannelThreadKinds = ['private', 'group'] as const;
export const gatewayChannelThreadKindSchema = z.enum(gatewayChannelThreadKinds);

export const gatewayBindingStatuses = ['pending', 'active', 'revoked'] as const;
export const gatewayBindingStatusSchema = z.enum(gatewayBindingStatuses);

/** Account binding is authoritative server state, never accepted from a bot update. */
export const gatewayChannelAccountBindingSchema = z
  .object({
    bindingId: gatewayOpaqueIdSchema,
    adapterId: gatewayOpaqueIdSchema,
    externalAccountId: gatewayOpaqueIdSchema,
    userId: gatewayOpaqueIdSchema,
    agentId: gatewayOpaqueIdSchema,
    status: gatewayBindingStatusSchema,
    createdAt: gatewayTimestampSchema,
    revokedAt: gatewayTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.status === 'revoked' && binding.revokedAt === null) {
      context.addIssue({
        code: 'custom',
        path: ['revokedAt'],
        message: 'Revoked binding requires revokedAt',
      });
    }
    if (binding.status !== 'revoked' && binding.revokedAt !== null) {
      context.addIssue({
        code: 'custom',
        path: ['revokedAt'],
        message: 'Active or pending binding cannot have revokedAt',
      });
    }
  });

export const gatewayChannelThreadBindingSchema = z
  .object({
    bindingId: gatewayOpaqueIdSchema,
    accountBindingId: gatewayOpaqueIdSchema,
    externalThreadId: gatewayOpaqueIdSchema,
    threadKind: gatewayChannelThreadKindSchema,
    notebookId: gatewayOpaqueIdSchema,
    conversationId: gatewayOpaqueIdSchema.nullable(),
    status: gatewayBindingStatusSchema,
    createdAt: gatewayTimestampSchema,
    revokedAt: gatewayTimestampSchema.nullable(),
  })
  .strict();

export type GatewayChannelAccountBinding = z.infer<
  typeof gatewayChannelAccountBindingSchema
>;
export type GatewayChannelThreadBinding = z.infer<
  typeof gatewayChannelThreadBindingSchema
>;
