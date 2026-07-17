import { z } from 'zod';

/** 平台可管理的输入与输出资产种类，不绑定任何垂直业务。 */
export const assetKinds = [
  'image',
  'audio',
  'video',
  'document',
  'data',
  'link',
  'other',
] as const;
export const assetKindSchema = z.enum(assetKinds);
export type AssetKind = z.infer<typeof assetKindSchema>;

/** turn资产随对话请求进入；space资产可在后续对话中复用。 */
export const assetScopes = ['turn', 'space'] as const;
export const assetScopeSchema = z.enum(assetScopes);
export type AssetScope = z.infer<typeof assetScopeSchema>;

export const assetOrigins = [
  'upload',
  'url_import',
  'generated',
  'library',
] as const;
export const assetOriginSchema = z.enum(assetOrigins);
export type AssetOrigin = z.infer<typeof assetOriginSchema>;

export const assetStatuses = [
  'pending',
  'processing',
  'ready',
  'failed',
  'tombstoned',
] as const;
export const assetStatusSchema = z.enum(assetStatuses);
export type AssetStatus = z.infer<typeof assetStatusSchema>;

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** 可持久化的通用资产元数据；对象存储地址和供应商URL不进入公共契约。 */
export const assetDescriptorSchema = z
  .object({
    assetId: opaqueIdSchema,
    scope: assetScopeSchema,
    kind: assetKindSchema,
    origin: assetOriginSchema,
    displayName: z.string().min(1).max(300),
    mimeType: z.string().min(1).max(255).nullable(),
    status: assetStatusSchema,
    currentVersionId: opaqueIdSchema.nullable(),
  })
  .strict();

export type AssetDescriptor = z.infer<typeof assetDescriptorSchema>;

/** 每次解析、转码或重新生成都产生不可变版本。 */
export const assetVersionDescriptorSchema = z
  .object({
    assetId: opaqueIdSchema,
    versionId: opaqueIdSchema,
    kind: assetKindSchema,
    mimeType: z.string().min(1).max(255),
    byteSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    contentHash: sha256Schema,
    status: z.enum(['processing', 'ready', 'failed', 'tombstoned']),
  })
  .strict();

export type AssetVersionDescriptor = z.infer<
  typeof assetVersionDescriptorSchema
>;

/** 消息和运行时只传不可变版本引用，不能依赖可能漂移的“最新版本”。 */
export const assetVersionReferenceSchema = z
  .object({
    assetId: opaqueIdSchema,
    versionId: opaqueIdSchema,
    kind: assetKindSchema,
  })
  .strict();

export type AssetVersionReference = z.infer<typeof assetVersionReferenceSchema>;

const allowedAssetTransitions: Readonly<
  Record<AssetStatus, readonly AssetStatus[]>
> = {
  pending: ['processing', 'failed', 'tombstoned'],
  processing: ['ready', 'failed', 'tombstoned'],
  ready: ['tombstoned'],
  failed: ['processing', 'tombstoned'],
  tombstoned: [],
};

/** 生命周期转换由运行时执行；模型不能直接把资产标记为ready。 */
export function canTransitionAssetStatus(
  from: AssetStatus,
  to: AssetStatus,
): boolean {
  return allowedAssetTransitions[from].includes(to);
}
