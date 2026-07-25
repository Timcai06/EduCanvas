'use client';

import { AssetUploadPanel } from '@/features/assets/asset-upload-panel';
import type { AssetItem } from '@/features/assets/assets-drawer';
import { SourceLinkImportPanel } from '@/features/assets/source-link-import-panel';
import { Sheet } from '../shared/sheet';

/** 输入框“+”触发的来源创建面；Studio不复用这些入口。 */
export function GeneralAssetEntrySheets({
  active,
  endpoint,
  onClose,
  onAdded,
}: {
  active: AssetItem['kind'] | null;
  endpoint: string;
  onClose: () => void;
  onAdded: (asset: AssetItem) => void;
}) {
  if (active === 'image' || active === 'document') {
    return (
      <Sheet
        label={active === 'image' ? '添加图片' : '添加文档来源'}
        onClose={onClose}
      >
        <AssetUploadPanel
          kind={active}
          endpoint={endpoint}
          fixedScope="space"
          onUploaded={onAdded}
        />
      </Sheet>
    );
  }
  if (active === 'link') {
    return (
      <Sheet label="导入网页来源" onClose={onClose}>
        <SourceLinkImportPanel onImported={onAdded} />
      </Sheet>
    );
  }
  return null;
}
