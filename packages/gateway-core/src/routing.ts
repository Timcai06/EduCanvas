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

export const gatewayResolvedRouteSchema = z
  .object({
    actorUserId: gatewayOpaqueIdSchema,
    agentId: gatewayOpaqueIdSchema,
    notebookId: gatewayOpaqueIdSchema,
    conversationId: gatewayOpaqueIdSchema,
    membershipRole: notebookMembershipRoleSchema,
  })
  .strict();

export type GatewayResolvedRoute = z.infer<typeof gatewayResolvedRouteSchema>;
