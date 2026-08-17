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
  'research_web',
  'generated',
  'library',
] as const;
export const assetOriginSchema = z.enum(assetOrigins);
export type AssetOrigin = z.infer<typeof assetOriginSchema>;

/**
 * D03：AssetVersion 派生物类型（derivation kind）——开放扩展 Vocabulary。
 * 新增派生类型只需在本 Registry 登记并让写入入口通过验证，不产生数据库
 * Migration；D04 的 Provider/版本属于独立 identity 维度，不编码进 kind。
 */
export const assetRepresentationKinds = [
  'original',
  'text',
  'preview',
  'thumbnail',
  'transcription',
  'keyframes',
] as const;
export const assetRepresentationKindSchema = z.enum(assetRepresentationKinds);
export type AssetRepresentationKind = z.infer<
  typeof assetRepresentationKindSchema
>;

/**
 * ADR-0026：文档派生表示的质量状态（决定 6，用户可见事实）。
 *
 * - `structured`：MinerU 或直接 Markdown 解码产生的结构化表示；
 * - `degraded_plain_text`：结构化转换失败后由纯文本抽取成功，不能与结构化结果等价；
 * - `failed`：结构化与降级路径均失败；
 * - `processing`：仍在转换，当前 Turn 不得静默带入；
 * - `unavailable`：该表示类型不携带文档质量维度（如 preview/thumbnail），
 *   或媒体类型不支持文档表示（ADR-0026 决定 4）。
 *
 * 与 `assetRepresentations.status`（生命周期）是独立维度：status='ready' 时
 * quality 仍要区分 structured / degraded_plain_text。只能追加、不能改写含义。
 */
export const representationQualityValues = [
  'processing',
  'structured',
  'degraded_plain_text',
  'failed',
  'unavailable',
] as const;
export const representationQualitySchema = z.enum(representationQualityValues);
export type RepresentationQuality = z.infer<typeof representationQualitySchema>;

/**
 * D03：Asset 派生处理任务类型（processor kind）——开放扩展 Vocabulary。
 * 新增处理器（如 OCR、去噪）只需登记本 Registry，不产生数据库 Migration。
 */
export const assetProcessorKinds = [
  'extract_text',
  'render_preview',
  'generate_thumbnail',
  'transcribe_audio',
  'process_video',
] as const;
export const assetProcessorKindSchema = z.enum(assetProcessorKinds);
export type AssetProcessorKind = z.infer<typeof assetProcessorKindSchema>;

/**
 * D04：派生结果多版本身份（variant / producer / producer_version）。
 *
 * identity = (assetVersionId, kind, variant, producer, producerVersion)，
 * 与 asset_representations / asset_processing_jobs 的唯一约束一一对应。
 * - variant：同 kind 下的变体（'default'、'low'/'high'、'corrected' 等）；
 * - producer：生产者（'default'、'local'、'cloud'、'human' 或具体
 *   provider/处理器标识）；
 * - producerVersion：生产者/算法/配置版本（如 'sherpa.v1'、'provider-a.v1'），
 *   可含点与连字符。
 * 三者均为开放扩展 Vocabulary：DB 只保留格式 CHECK，已登记成员由
 * 对应 Registry（assetRepresentationKinds/assetProcessorKinds）约束。
 */
export const representationVariantSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]{0,63}$/);
export const representationProducerSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9._-]{0,63}$/);
export const representationProducerVersionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);

export const representationIdentitySchema = z.object({
  variant: representationVariantSchema.default('default'),
  producer: representationProducerSchema.default('default'),
  producerVersion: representationProducerVersionSchema.default('v1'),
});
export type RepresentationIdentity = z.infer<
  typeof representationIdentitySchema
>;
export const DEFAULT_REPRESENTATION_IDENTITY: RepresentationIdentity = {
  variant: 'default',
  producer: 'default',
  producerVersion: 'v1',
};

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
