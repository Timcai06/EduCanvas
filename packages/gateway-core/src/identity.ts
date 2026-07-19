import { z } from 'zod';
import { gatewayOpaqueIdSchema, gatewayTimestampSchema } from './common';

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
