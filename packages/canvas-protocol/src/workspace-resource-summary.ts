import { z } from 'zod';
import {
  canvasResourceActionSchema,
  canvasResourceStatusSchema,
} from './resource';

/** Workspace 资源摘要协议版本；未知版本必须由调用方按无效响应处理。 */
export const WORKSPACE_RESOURCE_SUMMARY_SCHEMA_VERSION = 1 as const;

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const rendererSchema = z
  .object({
    rendererId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9][a-z0-9.-]*$/),
    rendererVersion: z.number().int().positive().max(10_000),
  })
  .strict();

const sourceVersionSchema = z
  .object({
    versionId: opaqueIdSchema,
    sequence: z.null(),
  })
  .strict();

const artifactVersionSchema = z
  .object({
    versionId: opaqueIdSchema,
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const workspaceResourceSurfaceRestStates = [
  'open',
  'folded',
  'pinned',
] as const;
export const workspaceResourceSurfaceRestStateSchema = z.enum(
  workspaceResourceSurfaceRestStates,
);

const surfaceSchema = z
  .object({
    /** null 表示当前主体没有 SurfacePosition；它不代表资源不存在。 */
    restState: workspaceResourceSurfaceRestStateSchema.nullable(),
  })
  .strict();

const provenanceSchema = z
  .object({
    /**
     * 这里只保留导航所需的不可变 Source 引用。读取每个 Source 时仍须重新鉴权；
     * Prompt、Provider 信息、operation/job 数据和生成正文不属于摘要协议。
     */
    sourceResourceIds: z.array(opaqueIdSchema).max(64),
    sourceReferences: z
      .array(
        z
          .object({
            resourceId: opaqueIdSchema,
            versionId: opaqueIdSchema,
          })
          .strict(),
      )
      .max(64),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.sourceResourceIds).size !== value.sourceResourceIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceResourceIds'],
        message: 'sourceResourceIds不能重复',
      });
    }
    const referencedResourceIds = value.sourceReferences.map(
      (reference) => reference.resourceId,
    );
    if (
      referencedResourceIds.length !== value.sourceResourceIds.length ||
      referencedResourceIds.some(
        (resourceId, index) => resourceId !== value.sourceResourceIds[index],
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceReferences'],
        message: 'sourceReferences必须与sourceResourceIds同序一致',
      });
    }
  });

const commonShape = {
  schemaVersion: z.literal(WORKSPACE_RESOURCE_SUMMARY_SCHEMA_VERSION),
  resourceId: opaqueIdSchema,
  notebookId: opaqueIdSchema,
  title: z.string().trim().min(1).max(300),
  updatedAt: z.iso.datetime({ offset: true }),
  status: canvasResourceStatusSchema,
  renderer: rendererSchema,
  allowedActions: z.array(canvasResourceActionSchema).max(16),
  provenance: provenanceSchema,
  surface: surfaceSchema,
} as const;

function addCommonInvariants<
  T extends {
    status: z.infer<typeof canvasResourceStatusSchema>;
    version: unknown;
    allowedActions: readonly string[];
  },
>(value: T, context: z.RefinementCtx): void {
  if (
    (value.status === 'ready' || value.status === 'archived') &&
    value.version === null
  ) {
    context.addIssue({
      code: 'custom',
      path: ['version'],
      message: '可读取资源摘要必须引用真实不可变版本',
    });
  }
  if (new Set(value.allowedActions).size !== value.allowedActions.length) {
    context.addIssue({
      code: 'custom',
      path: ['allowedActions'],
      message: 'allowedActions不能重复',
    });
  }
}

export const workspaceSourceResourceSummarySchema = z
  .object({
    ...commonShape,
    resourceKind: z.literal('source'),
    version: sourceVersionSchema.nullable(),
    context: z.object({ enabled: z.boolean() }).strict(),
  })
  .strict()
  .superRefine(addCommonInvariants);

export const workspaceArtifactResourceSummarySchema = z
  .object({
    ...commonShape,
    resourceKind: z.literal('artifact'),
    version: artifactVersionSchema.nullable(),
  })
  .strict()
  .superRefine(addCommonInvariants);

/**
 * Source 与 Artifact 只共享浏览器展示所需事实；Source 的 context 状态不能泄漏到
 * Artifact 分支，两个分支都只消费成员私有的 surface 状态。
 */
export const workspaceResourceSummarySchema = z.discriminatedUnion(
  'resourceKind',
  [
    workspaceSourceResourceSummarySchema,
    workspaceArtifactResourceSummarySchema,
  ],
);

export type WorkspaceSourceResourceSummary = z.infer<
  typeof workspaceSourceResourceSummarySchema
>;
export type WorkspaceArtifactResourceSummary = z.infer<
  typeof workspaceArtifactResourceSummarySchema
>;
export type WorkspaceResourceSummary = z.infer<
  typeof workspaceResourceSummarySchema
>;
export type WorkspaceResourceSurfaceRestState = z.infer<
  typeof workspaceResourceSurfaceRestStateSchema
>;

export type WorkspaceResourceSummaryValidation =
  | { ok: true; summary: WorkspaceResourceSummary }
  | { ok: false; errors: string[] };

/** 在缓存或浏览器状态接收摘要前执行严格白名单校验。 */
export function parseWorkspaceResourceSummary(
  input: unknown,
): WorkspaceResourceSummaryValidation {
  const result = workspaceResourceSummarySchema.safeParse(input);
  if (result.success) return { ok: true, summary: result.data };
  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}
