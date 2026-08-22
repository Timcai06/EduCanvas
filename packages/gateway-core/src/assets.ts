import { z } from 'zod';
import {
  assetDescriptorSchema,
  assetVersionDescriptorSchema,
} from '@educanvas/agent-core';
import { gatewayOpaqueIdSchema } from './common';

/**
 * Gateway 客户端资产上传/轮询的统一响应投影（DP10）。
 *
 * 只暴露两个不可变视图：资产描述（含当前状态/当前版本指针）与当前版本快照。
 * 对象存储地址、派生处理账本和供应商细节绝不进入 gateway 客户端契约。
 */
export const gatewayAssetSnapshotSchema = z
  .object({
    descriptor: assetDescriptorSchema,
    version: assetVersionDescriptorSchema.nullable(),
  })
  .strict();

export type GatewayAssetSnapshot = z.infer<typeof gatewayAssetSnapshotSchema>;

/** 上传成功后可直接构造 asset_ref part 的版本引用视图（ready 时 versionId 非空）。 */
export const gatewayAssetReadyReferenceSchema = z
  .object({
    assetId: gatewayOpaqueIdSchema,
    versionId: gatewayOpaqueIdSchema.nullable(),
    kind: assetDescriptorSchema.shape.kind,
    status: assetDescriptorSchema.shape.status,
  })
  .strict();

export type GatewayAssetReadyReference = z.infer<
  typeof gatewayAssetReadyReferenceSchema
>;
