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
    activationExpiresAt: gatewayTimestampSchema.nullable(),
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

/** 第一版用户连接控制面只公开产品级 provider，不泄漏 Adapter 实现名。 */
export const gatewayConnectionProviders = ['telegram', 'wechat', 'qq'] as const;
export const gatewayConnectionProviderSchema = z.enum(
  gatewayConnectionProviders,
);

export const gatewayConnectionAvailabilities = [
  'available',
  'disabled',
] as const;
export const gatewayConnectionAvailabilitySchema = z.enum(
  gatewayConnectionAvailabilities,
);

/**
 * Provider 目录是服务端能力声明；disabled 必须携带用户可理解的原因，
 * 客户端不得把未配置或无平台资格的渠道渲染成可连接。
 */
export const gatewayConnectionProviderDescriptorSchema = z
  .object({
    provider: gatewayConnectionProviderSchema,
    label: z.string().trim().min(1).max(40),
    availability: gatewayConnectionAvailabilitySchema,
    disabledReason: z.string().trim().min(1).max(160).nullable(),
    experimental: z.boolean(),
  })
  .strict()
  .superRefine((descriptor, context) => {
    if (
      descriptor.availability === 'disabled' &&
      descriptor.disabledReason === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['disabledReason'],
        message: 'Disabled provider requires a reason',
      });
    }
    if (
      descriptor.availability === 'available' &&
      descriptor.disabledReason !== null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['disabledReason'],
        message: 'Available provider cannot carry a disabled reason',
      });
    }
  });

/** 用户可见连接投影不包含外部账号 ID、Bot Token 或 Adapter ID。 */
export const gatewayChannelConnectionSchema = z
  .object({
    connectionId: gatewayOpaqueIdSchema,
    provider: gatewayConnectionProviderSchema,
    status: gatewayBindingStatusSchema,
    conversationId: gatewayOpaqueIdSchema,
    createdAt: gatewayTimestampSchema,
    activationExpiresAt: gatewayTimestampSchema.nullable(),
    revokedAt: gatewayTimestampSchema.nullable(),
  })
  .strict();

/** 当前 provider-neutral 授权方式；后续扫码或设备码通过新的 kind 扩展。 */
export const gatewayConnectionAuthorizationSchema = z
  .object({
    kind: z.literal('external_url'),
    url: z.string().url().max(2_048),
    expiresAt: gatewayTimestampSchema,
  })
  .strict();

/** 列表上限防止错误数据或恶意 Adapter 让设置页/TUI 无界渲染。 */
export const gatewayConnectionListSchema = z
  .object({
    providers: z.array(gatewayConnectionProviderDescriptorSchema).max(16),
    connections: z.array(gatewayChannelConnectionSchema).max(100),
  })
  .strict();

/** Connect 只接受 provider 与目标 Conversation，主体和有效期由服务端确定。 */
export const gatewayConnectionConnectRequestSchema = z
  .object({
    provider: gatewayConnectionProviderSchema,
    conversationId: gatewayOpaqueIdSchema,
  })
  .strict();

export const gatewayConnectionConnectResultSchema = z
  .object({
    connection: gatewayChannelConnectionSchema,
    authorization: gatewayConnectionAuthorizationSchema,
  })
  .strict();

/** Revoke 只接受不透明连接 ID，Repository 必须再次校验当前主体。 */
export const gatewayConnectionRevokeRequestSchema = z
  .object({ connectionId: gatewayOpaqueIdSchema })
  .strict();

export const gatewayConnectionRevokeResultSchema = z
  .object({ connection: gatewayChannelConnectionSchema })
  .strict();

export type GatewayConnectionProvider = z.infer<
  typeof gatewayConnectionProviderSchema
>;
export type GatewayConnectionProviderDescriptor = z.infer<
  typeof gatewayConnectionProviderDescriptorSchema
>;
export type GatewayChannelConnection = z.infer<
  typeof gatewayChannelConnectionSchema
>;
export type GatewayConnectionAuthorization = z.infer<
  typeof gatewayConnectionAuthorizationSchema
>;
export type GatewayConnectionList = z.infer<typeof gatewayConnectionListSchema>;
export type GatewayConnectionConnectRequest = z.infer<
  typeof gatewayConnectionConnectRequestSchema
>;
export type GatewayConnectionConnectResult = z.infer<
  typeof gatewayConnectionConnectResultSchema
>;
export type GatewayConnectionRevokeRequest = z.infer<
  typeof gatewayConnectionRevokeRequestSchema
>;
export type GatewayConnectionRevokeResult = z.infer<
  typeof gatewayConnectionRevokeResultSchema
>;
