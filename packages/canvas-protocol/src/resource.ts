import { z } from 'zod';

/** Canvas资源描述协议版本；版本升级必须保留显式兼容判断，不能静默猜测。 */
export const CANVAS_RESOURCE_SCHEMA_VERSION = 1 as const;

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const canvasResourceKinds = ['source', 'artifact'] as const;
export const canvasResourceKindSchema = z.enum(canvasResourceKinds);

/**
 * Representation描述资源应如何被理解，而不是资源从哪里读取。
 * MIME最多255字符以匹配现有Asset持久化边界；内容地址和对象存储键不进入公共协议。
 */
export const canvasRepresentationKinds = [
  'structured',
  'document',
  'image',
  'text',
  'audio',
  'video',
  'web_page',
  'interactive_app',
  'code',
  'dataset',
] as const;
export const canvasRepresentationKindSchema = z.enum(canvasRepresentationKinds);

export const canvasTrustTiers = ['tier1', 'tier2', 'tier3'] as const;
export const canvasTrustTierSchema = z.enum(canvasTrustTiers);

/**
 * 动作是服务端授权后的浏览器安全交集，不是客户端可申请的权限。
 * Renderer只能显示这里已经允许的动作，仍须在执行端再次鉴权。
 */
export const canvasResourceActions = [
  'view',
  'download',
  'annotate',
  'edit',
  'regenerate',
  'run',
  'cancel',
  'delete',
  'submit_candidate_learning_event',
] as const;
export const canvasResourceActionSchema = z.enum(canvasResourceActions);

export const canvasResourceStatuses = [
  'processing',
  'ready',
  'failed',
  'unavailable',
  'archived',
] as const;
export const canvasResourceStatusSchema = z.enum(canvasResourceStatuses);

export const canvasRuntimeKinds = [
  'none',
  'web_sandbox',
  'experiment',
] as const;
export const canvasRuntimeKindSchema = z.enum(canvasRuntimeKinds);

/**
 * Runtime要求只表达当前资源需要的隔离能力和硬上限。
 * 它不能授予网络、Secret、宿主文件系统或更高配额，组合根必须再与服务端策略求交集。
 */
export const canvasRuntimeRequirementSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({
      kind: z.literal('web_sandbox'),
      protocolVersion: z.literal(1),
      maxDurationMs: z.number().int().min(100).max(300_000),
      maxOutputBytes: z
        .number()
        .int()
        .positive()
        .max(5 * 1024 * 1024),
      network: z.literal('none'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('experiment'),
      protocolVersion: z.literal(1),
      maxDurationMs: z.number().int().min(100).max(900_000),
      maxOutputBytes: z
        .number()
        .int()
        .positive()
        .max(100 * 1024 * 1024),
      network: z.enum(['none', 'allowlist']),
    })
    .strict(),
]);

export const canvasResourceProvenanceSchema = z
  .object({
    origin: z.enum([
      'upload',
      'url_import',
      'agent_generated',
      'user_created',
      'derived',
    ]),
    createdBy: z.enum(['user', 'agent', 'system', 'import']),
    createdAt: z.iso.datetime({ offset: true }),
    sourceResourceIds: z.array(opaqueIdSchema).max(32),
    operationId: opaqueIdSchema.nullable(),
    /**
     * 仅允许展示经服务端净化的生成摘要；原始Prompt、Provider响应和Secret不属于该协议。
     */
    generator: z
      .object({
        provider: z.string().trim().min(1).max(128).nullable(),
        model: z.string().trim().min(1).max(256).nullable(),
        promptSummary: z.string().trim().min(1).max(500).nullable(),
      })
      .strict()
      .nullable(),
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
  });

/**
 * Source与Artifact进入Canvas前共享的浏览器安全资源描述。
 *
 * `notebookId`只能由已鉴权的服务端Adapter填入，它是归属投影而不是访问凭据。
 * 内容本体、私有判分键、对象存储键和Provider原始数据必须留在各自事实源。
 */
export const canvasResourceSchema = z
  .object({
    schemaVersion: z.literal(CANVAS_RESOURCE_SCHEMA_VERSION),
    resourceId: opaqueIdSchema,
    notebookId: opaqueIdSchema,
    resourceKind: canvasResourceKindSchema,
    title: z.string().trim().min(1).max(300),
    status: canvasResourceStatusSchema,
    version: z
      .object({
        versionId: opaqueIdSchema,
        /**
         * Artifact有单调版本号，Source通常只有不可变versionId；不为统一协议伪造序号。
         */
        sequence: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .nullable(),
        checksum: sha256Schema.nullable(),
      })
      .strict()
      .nullable(),
    representation: z
      .object({
        kind: canvasRepresentationKindSchema,
        mimeType: z.string().trim().min(1).max(255),
        byteSize: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER)
          .nullable(),
      })
      .strict(),
    renderer: z
      .object({
        rendererId: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[a-z0-9][a-z0-9.-]*$/),
        rendererVersion: z.number().int().positive().max(10_000),
      })
      .strict(),
    trustTier: canvasTrustTierSchema,
    allowedActions: z.array(canvasResourceActionSchema).max(16),
    canProduceCandidateLearningEvents: z.boolean(),
    provenance: canvasResourceProvenanceSchema,
    runtime: canvasRuntimeRequirementSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.status === 'ready' || value.status === 'archived') &&
      value.version === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['version'],
        message: '可读取资源必须引用真实不可变版本',
      });
    }
    if (new Set(value.allowedActions).size !== value.allowedActions.length) {
      context.addIssue({
        code: 'custom',
        path: ['allowedActions'],
        message: 'allowedActions不能重复',
      });
    }
    if (
      value.canProduceCandidateLearningEvents &&
      (value.trustTier !== 'tier1' ||
        !value.allowedActions.includes('submit_candidate_learning_event'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['canProduceCandidateLearningEvents'],
        message: '候选学习事件只允许Tier 1且必须显式开放对应动作',
      });
    }
    if (
      value.allowedActions.includes('submit_candidate_learning_event') &&
      !value.canProduceCandidateLearningEvents
    ) {
      context.addIssue({
        code: 'custom',
        path: ['allowedActions'],
        message: '候选学习事件动作与能力标记必须一致',
      });
    }
    if (value.trustTier === 'tier1' && value.runtime.kind !== 'none') {
      context.addIssue({
        code: 'custom',
        path: ['runtime'],
        message: 'Tier 1资源不能依赖不受信Runtime',
      });
    }
    if (
      (value.runtime.kind === 'web_sandbox' && value.trustTier !== 'tier2') ||
      (value.runtime.kind === 'experiment' && value.trustTier !== 'tier3')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['runtime'],
        message: 'Runtime种类必须与信任层级一致',
      });
    }
  });

export type CanvasResource = z.infer<typeof canvasResourceSchema>;
export type CanvasResourceKind = z.infer<typeof canvasResourceKindSchema>;
export type CanvasRepresentationKind = z.infer<
  typeof canvasRepresentationKindSchema
>;
export type CanvasTrustTier = z.infer<typeof canvasTrustTierSchema>;
export type CanvasResourceAction = z.infer<typeof canvasResourceActionSchema>;
export type CanvasRuntimeKind = z.infer<typeof canvasRuntimeKindSchema>;
export type CanvasRuntimeRequirement = z.infer<
  typeof canvasRuntimeRequirementSchema
>;

/** 公共边界使用判别结果，调用方不得在失败时回退执行未校验内容。 */
export type CanvasResourceValidation =
  { ok: true; resource: CanvasResource } | { ok: false; errors: string[] };

/** 在资源进入Renderer选择前执行完整白名单校验。 */
export function validateCanvasResource(
  input: unknown,
): CanvasResourceValidation {
  const result = canvasResourceSchema.safeParse(input);
  if (result.success) return { ok: true, resource: result.data };
  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}
