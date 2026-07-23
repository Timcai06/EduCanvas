/**
 * Gateway 路由与权限 — Notebook 成员角色与操作权限。
 *
 * ## 四层角色
 *
 * | 角色 | 权限范围 |
 * |------|---------|
 * | owner | 全部权限（含成员管理、Notebook 设置） |
 * | editor | 读写内容（创建对话、写 Source/Artifact），不能管成员 |
 * | contributor | 只读+回复（不能创建新对话、写 Source） |
 * | viewer | 只读 |
 *
 * ## 路由解析
 *
 * RouteResolver 接受 Principal + RouteHint + 所需权限，
 * 返回 GatewayResolvedRoute（含 actorUserId, agentId, notebookId, conversationId）。
 * 解析失败 → ROUTE_NOT_FOUND。
 */

import { z } from 'zod';
import { gatewayOpaqueIdSchema, gatewayTimestampSchema } from './common';

export const notebookVisibilityValues = ['private', 'shared'] as const;
export const notebookVisibilitySchema = z.enum(notebookVisibilityValues);

export const notebookMembershipRoles = [
  'owner',
  'editor',
  'contributor',
  'viewer',
] as const;
export const notebookMembershipRoleSchema = z.enum(notebookMembershipRoles);
export type NotebookMembershipRole = z.infer<
  typeof notebookMembershipRoleSchema
>;

export const notebookPermissions = [
  'notebook.read',
  'conversation.create',
  'conversation.reply',
  'source.write',
  'artifact.write',
  'membership.manage',
  'notebook.manage',
] as const;
export const notebookPermissionSchema = z.enum(notebookPermissions);
export type NotebookPermission = z.infer<typeof notebookPermissionSchema>;

const rolePermissions: Record<
  NotebookMembershipRole,
  readonly NotebookPermission[]
> = {
  owner: notebookPermissions,
  editor: [
    'notebook.read',
    'conversation.create',
    'conversation.reply',
    'source.write',
    'artifact.write',
    'membership.manage',
  ],
  contributor: [
    'notebook.read',
    'conversation.create',
    'conversation.reply',
    'source.write',
    'artifact.write',
  ],
  viewer: ['notebook.read'],
};

export function permissionsForNotebookRole(
  role: NotebookMembershipRole,
): readonly NotebookPermission[] {
  return rolePermissions[role];
}

export function notebookRoleAllows(
  role: NotebookMembershipRole,
  permission: NotebookPermission,
): boolean {
  return rolePermissions[role].includes(permission);
}

export const notebookMembershipSchema = z
  .object({
    notebookId: gatewayOpaqueIdSchema,
    userId: gatewayOpaqueIdSchema,
    role: notebookMembershipRoleSchema,
    grantedByUserId: gatewayOpaqueIdSchema,
    grantedAt: gatewayTimestampSchema,
    expiresAt: gatewayTimestampSchema.nullable(),
    revokedAt: gatewayTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((membership, context) => {
    if (
      membership.expiresAt !== null &&
      membership.expiresAt <= membership.grantedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Membership expiry must follow grant time',
      });
    }
    if (
      membership.revokedAt !== null &&
      membership.revokedAt < membership.grantedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['revokedAt'],
        message: 'Membership revocation cannot precede grant time',
      });
    }
  });

export type NotebookMembership = z.infer<typeof notebookMembershipSchema>;

export function isNotebookMembershipActive(
  membership: NotebookMembership,
  now: Date,
): boolean {
  const nowIso = now.toISOString();
  return (
    membership.revokedAt === null &&
    (membership.expiresAt === null || membership.expiresAt > nowIso)
  );
}

export const delegatedGrantKinds = [
  'education.teacher',
  'education.guardian',
  'platform.operator',
] as const;
export const delegatedGrantKindSchema = z.enum(delegatedGrantKinds);

export const delegatedGrantScopes = [
  'learning_evidence.read',
  'assignment.manage',
  'source.publish',
  'safety.review',
  'operation.audit',
] as const;
export const delegatedGrantScopeSchema = z.enum(delegatedGrantScopes);

export const delegatedGrantSchema = z
  .object({
    grantId: gatewayOpaqueIdSchema,
    kind: delegatedGrantKindSchema,
    granteeUserId: gatewayOpaqueIdSchema,
    subjectUserId: gatewayOpaqueIdSchema,
    notebookId: gatewayOpaqueIdSchema.nullable(),
    scopes: z.array(delegatedGrantScopeSchema).min(1).max(16),
    grantedByUserId: gatewayOpaqueIdSchema,
    grantedAt: gatewayTimestampSchema,
    expiresAt: gatewayTimestampSchema,
    revokedAt: gatewayTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((grant, context) => {
    if (new Set(grant.scopes).size !== grant.scopes.length) {
      context.addIssue({
        code: 'custom',
        path: ['scopes'],
        message: 'Delegated scopes must be unique',
      });
    }
    if (grant.expiresAt <= grant.grantedAt) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Delegated grant must expire after it is granted',
      });
    }
  });

export type DelegatedGrant = z.infer<typeof delegatedGrantSchema>;

export const gatewayRouteHintSchema = z
  .object({
    notebookId: gatewayOpaqueIdSchema.optional(),
    conversationId: gatewayOpaqueIdSchema.optional(),
  })
  .strict();

/** 服务端从 Conversation 真值解析出的 Agent Profile 标识；客户端不得覆盖。 */
export const gatewayAgentProfileIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9._-]*$/);

/** Gateway 路由中经过严格校验的 Agent Profile 标识。 */
export type GatewayAgentProfileId = z.infer<typeof gatewayAgentProfileIdSchema>;

export const gatewayResolvedRouteSchema = z
  .object({
    actorUserId: gatewayOpaqueIdSchema,
    agentId: gatewayOpaqueIdSchema,
    notebookId: gatewayOpaqueIdSchema,
    conversationId: gatewayOpaqueIdSchema,
    agentProfileId: gatewayAgentProfileIdSchema,
    membershipRole: notebookMembershipRoleSchema,
  })
  .strict();

export type GatewayResolvedRoute = z.infer<typeof gatewayResolvedRouteSchema>;
