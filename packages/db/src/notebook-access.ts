import {
  notebookRoleAllows,
  permissionsForNotebookRole,
  type NotebookMembershipRole,
  type NotebookPermission,
} from '@educanvas/gateway-core';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { getDb } from './client';
import { notebookMemberships, spaces } from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
export type NotebookAccessExecutor = Database | DatabaseTransaction;

export interface NotebookAccessSnapshot {
  notebookId: string;
  role: NotebookMembershipRole;
  permissions: readonly NotebookPermission[];
}

/** 对外统一隐藏 Notebook 不存在、成员不存在、成员失效和权限不足的差异。 */
export class NotebookAccessNotFoundError extends Error {
  readonly code = 'resource_not_found';

  constructor() {
    super('Notebook resource not found');
    this.name = 'NotebookAccessNotFoundError';
  }
}

/**
 * 解析服务端可信主体的有效 Notebook 成员资格。
 * 客户端声明的 role、permission 或 owner 字段不会参与授权。
 */
export async function resolveNotebookAccess(
  executor: NotebookAccessExecutor,
  input: {
    notebookId: string;
    trustedSubjectId: string;
    requiredPermission: NotebookPermission;
    now?: Date;
  },
): Promise<NotebookAccessSnapshot | null> {
  const now = input.now ?? new Date();
  const [membership] = await executor
    .select({
      notebookId: spaces.id,
      role: notebookMemberships.role,
    })
    .from(spaces)
    .innerJoin(
      notebookMemberships,
      and(
        eq(notebookMemberships.notebookId, spaces.id),
        eq(notebookMemberships.userId, input.trustedSubjectId),
      ),
    )
    .where(
      and(
        eq(spaces.id, input.notebookId),
        eq(spaces.status, 'active'),
        isNull(notebookMemberships.revokedAt),
        or(
          isNull(notebookMemberships.expiresAt),
          gt(notebookMemberships.expiresAt, now),
        ),
      ),
    )
    .limit(1);
  if (!membership) return null;

  const role = membership.role as NotebookMembershipRole;
  if (!notebookRoleAllows(role, input.requiredPermission)) return null;
  return {
    notebookId: membership.notebookId,
    role,
    permissions: permissionsForNotebookRole(role),
  };
}

export async function requireNotebookAccess(
  executor: NotebookAccessExecutor,
  input: Parameters<typeof resolveNotebookAccess>[1],
): Promise<NotebookAccessSnapshot> {
  const access = await resolveNotebookAccess(executor, input);
  if (!access) throw new NotebookAccessNotFoundError();
  return access;
}
