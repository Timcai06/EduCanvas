import type { AssetItem } from './assets-drawer';
import { z } from 'zod';

interface AssetResponseItem {
  descriptor: {
    assetId: string;
    scope: AssetItem['scope'];
    kind: AssetItem['kind'];
    displayName: string;
    status: AssetItem['status'];
    currentVersionId: string | null;
  };
  version: { versionId: string } | null;
}

const assetResponseItemSchema = z.object({
  descriptor: z.object({
    assetId: z.string(),
    scope: z.enum(['turn', 'space']),
    kind: z.enum(['image', 'document', 'link']),
    displayName: z.string(),
    status: z.enum(['pending', 'processing', 'ready', 'failed', 'tombstoned']),
    currentVersionId: z.string().nullable(),
  }),
  version: z.object({ versionId: z.string() }).nullable(),
});

function toItem(
  asset: AssetResponseItem,
  options: { enableSpaceByDefault?: boolean } = {},
): AssetItem {
  const versionId =
    asset.version?.versionId ?? asset.descriptor.currentVersionId;
  return {
    id: asset.descriptor.assetId,
    versionId,
    label: asset.descriptor.displayName,
    kind: asset.descriptor.kind,
    scope: asset.descriptor.scope,
    status: asset.descriptor.status,
    enabled:
      options.enableSpaceByDefault === true &&
      asset.descriptor.scope === 'space' &&
      asset.descriptor.status === 'ready' &&
      versionId !== null,
    selectable: asset.descriptor.status === 'ready' && versionId !== null,
  };
}

async function publicError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown };
    };
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // Stable fallback below; raw server errors never reach UI.
  }
  return fallback;
}

export async function loadAssets(
  endpoint = '/api/v1/assets',
  options: { enableSpaceByDefault?: boolean } = {},
): Promise<readonly AssetItem[]> {
  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok)
    throw new Error(await publicError(response, '暂时无法读取资料。'));
  const parsed = z
    .object({ assets: z.array(assetResponseItemSchema) })
    .safeParse(await response.json());
  if (!parsed.success) throw new Error('资料响应格式不正确。');
  return parsed.data.assets.map((asset) => toItem(asset, options));
}

async function parseAssetMutationResponse(
  response: Response,
  invalidMessage: string,
): Promise<AssetItem> {
  const parsed = z
    .object({ asset: assetResponseItemSchema })
    .safeParse(await response.json());
  if (!parsed.success) throw new Error(invalidMessage);
  return toItem(parsed.data.asset);
}

async function parseAssetMutationOrThrow(
  response: Response,
  fallback: string,
  invalidMessage: string,
): Promise<AssetItem> {
  if (!response.ok) {
    throw new Error(await publicError(response, fallback));
  }
  return parseAssetMutationResponse(response, invalidMessage);
}

export async function uploadAsset(input: {
  file: File;
  scope: AssetItem['scope'];
  endpoint?: string;
}): Promise<AssetItem> {
  const form = new FormData();
  form.set('file', input.file);
  form.set('scope', input.scope);
  const response = await fetch(input.endpoint ?? '/api/v1/assets', {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    throw new Error(await publicError(response, '文件上传暂时不可用。'));
  }
  return parseAssetMutationResponse(response, '上传响应格式不正确。');
}

export async function importLinkAsset(input: {
  url: string;
  endpoint?: string;
}): Promise<AssetItem> {
  const response = await fetch(input.endpoint ?? '/api/v1/chat/assets/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: input.url }),
  });
  return parseAssetMutationOrThrow(
    response,
    '暂时无法导入链接。',
    '导入响应格式不正确。',
  );
}

/** 预览 API 返回的数据结构 */
export interface PreviewData {
  mimeType: string;
  fileName?: string;
  content?: string;
  fileUrl?: string;
  warnings?: string[];
}

const previewDataSchema = z.object({
  mimeType: z.string(),
  fileName: z.string().optional(),
  content: z.string().optional(),
  fileUrl: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});

/**
 * 软删除指定资产。服务端将资产及版本标记为 tombstoned。
 * @param assetId - 资产 UUID
 * @param endpoint - API 端点 URL
 * @returns true 表示删除成功
 * @throws 资产不存在或无权访问时抛出 Error
 */
export async function deleteAsset(
  assetId: string,
  endpoint?: string,
): Promise<boolean> {
  const url =
    endpoint ??
    `/api/v1/chat/assets/${encodeURIComponent(assetId)}`;
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? '文件不存在或已删除。'
        : '暂时无法删除文件。',
    );
  }
  const parsed = z
    .object({ deleted: z.boolean() })
    .safeParse(await response.json());
  if (!parsed.success) throw new Error('删除响应格式不正确。');
  return parsed.data.deleted;
}

/**
 * 获取资产的预览数据。
 * PDF 返回 fileUrl，DOCX 返回 mammoth HTML content，MD/TXT 返回文本 content。
 * @param assetId - 资产 UUID
 * @param endpoint - 预览 API 端点 URL
 */
export async function fetchAssetPreview(
  assetId: string,
  endpoint?: string,
): Promise<PreviewData> {
  const url =
    endpoint ??
    `/api/v1/chat/assets/${encodeURIComponent(assetId)}/preview`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      response.status === 415
        ? '暂不支持预览此文件格式。'
        : '暂时无法加载预览。',
    );
  }
  const parsed = previewDataSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('预览响应格式不正确。');
  return parsed.data;
}
