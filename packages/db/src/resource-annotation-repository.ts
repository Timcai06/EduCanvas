import { and, asc, eq } from 'drizzle-orm';
import { getDb } from './client';
import { resourceAnnotations } from './schema';

type Database = ReturnType<typeof getDb>;

/** 批注几何的归一化坐标（0..1，相对被批注资源的可视区域），与渲染分辨率解耦。 */
export interface ResourceAnnotationGeometry {
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly page?: number;
}

function isUnit(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

export function isResourceAnnotationGeometry(
  value: unknown,
): value is ResourceAnnotationGeometry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!isUnit(record.x) || !isUnit(record.y)) return false;
  if (record.width !== undefined && !isUnit(record.width)) return false;
  if (record.height !== undefined && !isUnit(record.height)) return false;
  if (
    typeof record.width === 'number' &&
    (record.x as number) + record.width > 1
  ) {
    return false;
  }
  if (
    typeof record.height === 'number' &&
    (record.y as number) + record.height > 1
  ) {
    return false;
  }
  if (
    record.page !== undefined &&
    (!Number.isInteger(record.page) || (record.page as number) < 1)
  ) {
    return false;
  }
  return true;
}

export class ResourceAnnotationValidationError extends Error {
  override readonly name = 'ResourceAnnotationValidationError';
}

export type ResourceAnnotationRow = typeof resourceAnnotations.$inferSelect;

export interface CreateResourceAnnotationInput {
  readonly spaceId: string;
  readonly resourceKind: 'asset' | 'artifact';
  readonly resourceId: string;
  readonly resourceVersionId?: string | null;
  readonly ownerSubjectId: string;
  readonly authorPen: 'dai' | 'zhusha';
  readonly kind: 'circle' | 'underline' | 'strike' | 'note' | 'seal';
  readonly geometry: unknown;
  readonly body?: string | null;
  readonly source: 'voice' | 'canvas' | 'chat';
  readonly operationId?: string | null;
}

/**
 * 纸面批注仓储。几何合法性在写入边界 fail fast（DB CHECK 兜底）；
 * 删除按 id + ownerSubjectId 双条件，防止跨主体误删。
 */
export class DrizzleResourceAnnotationRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async listForResource(input: {
    readonly spaceId: string;
    readonly ownerSubjectId: string;
    readonly resourceKind: 'asset' | 'artifact';
    readonly resourceId: string;
  }): Promise<readonly ResourceAnnotationRow[]> {
    return this.database
      .select()
      .from(resourceAnnotations)
      .where(
        and(
          eq(resourceAnnotations.spaceId, input.spaceId),
          eq(resourceAnnotations.ownerSubjectId, input.ownerSubjectId),
          eq(resourceAnnotations.resourceKind, input.resourceKind),
          eq(resourceAnnotations.resourceId, input.resourceId),
        ),
      )
      .orderBy(asc(resourceAnnotations.createdAt));
  }

  async create(
    input: CreateResourceAnnotationInput,
  ): Promise<ResourceAnnotationRow> {
    if (!isResourceAnnotationGeometry(input.geometry)) {
      throw new ResourceAnnotationValidationError(
        '批注几何必须是归一化坐标对象。',
      );
    }
    if (input.kind === 'note' && !input.body?.trim()) {
      throw new ResourceAnnotationValidationError('note 批注必须有文字。');
    }
    const [row] = await this.database
      .insert(resourceAnnotations)
      .values({
        spaceId: input.spaceId,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        resourceVersionId: input.resourceVersionId ?? null,
        ownerSubjectId: input.ownerSubjectId,
        authorPen: input.authorPen,
        kind: input.kind,
        geometry: input.geometry,
        body: input.body ?? null,
        source: input.source,
        operationId: input.operationId ?? null,
      })
      .returning();
    if (!row) throw new Error('resource annotation insert returned no row');
    return row;
  }

  /** 删除按 id + ownerSubjectId 双条件；返回是否确实删掉了行。 */
  async remove(input: {
    readonly id: string;
    readonly spaceId: string;
    readonly resourceKind: 'asset' | 'artifact';
    readonly resourceId: string;
    readonly ownerSubjectId: string;
  }): Promise<boolean> {
    const deleted = await this.database
      .delete(resourceAnnotations)
      .where(
        and(
          eq(resourceAnnotations.id, input.id),
          eq(resourceAnnotations.spaceId, input.spaceId),
          eq(resourceAnnotations.resourceKind, input.resourceKind),
          eq(resourceAnnotations.resourceId, input.resourceId),
          eq(resourceAnnotations.ownerSubjectId, input.ownerSubjectId),
        ),
      )
      .returning({ id: resourceAnnotations.id });
    return deleted.length > 0;
  }
}
