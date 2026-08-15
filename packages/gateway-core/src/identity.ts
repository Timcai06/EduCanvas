import { z } from 'zod';
import { gatewayOpaqueIdSchema, gatewayTimestampSchema } from './common';

/**
 * 连接端/主体模型用于统一“谁在发起/谁接收”：
 * role/transport/adapterId 与 principal 共同构成后续鉴权与审计输入。
 */
export const gatewayConnectionRoles = [
  'client',
  'channel',
  'node',
  'operator',
] as const;
export const gatewayConnectionRoleSchema = z.enum(gatewayConnectionRoles);
export type GatewayConnectionRole = z.infer<typeof gatewayConnectionRoleSchema>;

export const gatewayPrincipalKinds = [
  'user',
  'service',
  'anonymous_compat',
] as const;
export const gatewayPrincipalKindSchema = z.enum(gatewayPrincipalKinds);

export const gatewayAuthenticationMethods = [
  'session_cookie',
  'bearer',
  'channel_binding',
  'node_pairing',
  'service_credential',
  'fixture',
] as const;
export const gatewayAuthenticationMethodSchema = z.enum(
  gatewayAuthenticationMethods,
);

/**
 * Gateway 认证后生成的可信主体。Transport Adapter 的原始输入不得接受该对象。
 * userId 与 agentId 始终由服务端绑定，匿名演示也使用隔离的派生 ID。
 */
export const gatewayPrincipalSchema = z
  .object({
    subjectId: gatewayOpaqueIdSchema,
    userId: gatewayOpaqueIdSchema,
    agentId: gatewayOpaqueIdSchema,
    kind: gatewayPrincipalKindSchema,
    authenticationMethod: gatewayAuthenticationMethodSchema,
    authenticatedAt: gatewayTimestampSchema,
  })
  .strict();

export type GatewayPrincipal = z.infer<typeof gatewayPrincipalSchema>;

export const gatewayTransportKinds = [
  'web',
  'tui',
  'desktop',
  'telegram',
  'node',
  'fixture',
] as const;
export const gatewayTransportKindSchema = z.enum(gatewayTransportKinds);
export type GatewayTransportKind = z.infer<typeof gatewayTransportKindSchema>;

export const gatewayConnectionSchema = z
  .object({
    connectionId: gatewayOpaqueIdSchema,
    role: gatewayConnectionRoleSchema,
    transport: gatewayTransportKindSchema,
    adapterId: gatewayOpaqueIdSchema,
  })
  .strict();

export type GatewayConnection = z.infer<typeof gatewayConnectionSchema>;
