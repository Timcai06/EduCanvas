'use client';

import { LinkSimple } from '@phosphor-icons/react';
import { useState } from 'react';
import { importLinkAsset } from './asset-client';
import type { AssetItem } from './assets-drawer';

/** 输入框加号中的网页来源入口；Studio只浏览和管理，不承担创建动作。 */
export function SourceLinkImportPanel({
  onImported,
}: {
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
    void importLinkAsset({ url })
      .then(onImported)
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error ? reason.message : '暂时无法导入链接。',
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-line bg-card p-5 shadow-[var(--shadow-float)]">
        <span className="grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent">
          <LinkSimple size={23} />
        </span>
        <h3 className="mt-4 font-display text-lg font-semibold text-ink">
          导入网页来源
        </h3>
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          只读取公开网页正文并保存到当前笔记本。内网地址、超大页面和不可解析内容会被明确拒绝。
        </p>
      </div>
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-ink">
          网页地址
        </span>
        <input
          autoFocus
          type="url"
          value={value}
          disabled={busy}
          maxLength={1_024}
          placeholder="https://example.com/article"
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          className="ec-input min-h-12 w-full rounded-2xl px-4 text-sm text-ink"
        />
      </label>
      <button
        type="button"
        disabled={busy || value.trim().length === 0}
        onClick={submit}
        className="min-h-12 w-full rounded-2xl bg-accent px-4 font-medium text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:bg-surface-strong disabled:text-ink-faint"
      >
        {busy ? '正在安全读取…' : '导入到当前笔记本'}
      </button>
      <p className={`min-h-5 text-sm ${error ? 'text-bad' : 'text-ink-muted'}`}>
        {error ??
          '网页内容会作为来源快照保存，不会把内部存储地址暴露给浏览器。'}
      </p>
    </div>
  );
}
