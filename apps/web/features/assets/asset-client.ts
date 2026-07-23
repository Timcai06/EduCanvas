import type { AssetItem } from './assets-drawer';

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
  const body = (await response.json()) as { assets?: unknown };
  if (!Array.isArray(body.assets)) throw new Error('资料响应格式不正确。');
  return (body.assets as AssetResponseItem[]).map((asset) =>
    toItem(asset, options),
  );
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
  const body = (await response.json()) as { asset?: AssetResponseItem };
  if (!body.asset) throw new Error('上传响应格式不正确。');
  return toItem(body.asset);
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
  if (!response.ok) {
    throw new Error(await publicError(response, '暂时无法导入链接。'));
  }
  const body = (await response.json()) as { asset?: AssetResponseItem };
  if (!body.asset) throw new Error('导入响应格式不正确。');
  return toItem(body.asset);
}
