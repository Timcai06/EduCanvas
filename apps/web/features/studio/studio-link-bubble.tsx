'use client';

import { importLinkAsset } from '@/features/assets/asset-client';
import type { AssetItem } from '@/features/assets/assets-drawer';
import { useState } from 'react';
import './studio-bubbles.css';

/** 导入网页需要文本输入，因此在最终动作处使用一枚临时气泡，不扩张为抽屉。 */
export function StudioLinkBubble({
  onCancel,
  onImported,
}: {
  onCancel: () => void;
  onImported: (asset: AssetItem) => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const url = value.trim();
    if (!url || busy) return;
    setBusy(true);
    setError(null);
    importLinkAsset({ url })
      .then(onImported)
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error ? reason.message : '暂时无法导入链接。',
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="studio-link-bubble">
      <input
        autoFocus
        type="url"
        value={value}
        disabled={busy}
        aria-label="网页地址"
        placeholder="https://…"
        className="studio-link-bubble__field"
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
          if (event.key === 'Escape') onCancel();
        }}
      />
      <button
        type="button"
        disabled={busy || value.trim().length === 0}
        onClick={submit}
        className="studio-link-bubble__action"
      >
        {busy ? '导入中…' : '导入'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="studio-link-bubble__action studio-link-bubble__action--muted"
      >
        取消
      </button>
      <p data-error={Boolean(error)}>{error ?? '保存到当前笔记本来源'}</p>
    </div>
  );
}
