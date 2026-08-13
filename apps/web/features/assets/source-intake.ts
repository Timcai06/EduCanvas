import { importLinkAsset, uploadAsset } from './asset-client';
import type { AssetItem } from './assets-drawer';

/** 所有 Workspace 来源入口共享的唯一请求边界。 */
export function uploadWorkspaceSource(input: {
  file: File;
  scope: AssetItem['scope'];
  endpoint?: string;
}) {
  return uploadAsset(input);
}

export function importWorkspaceLink(url: string) {
  return importLinkAsset({ url: url.trim() });
}
