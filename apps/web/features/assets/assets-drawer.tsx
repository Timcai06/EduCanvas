'use client';

import {
  FilePdf,
  Image as ImageIcon,
  LinkSimple,
  SpinnerGap,
} from '@phosphor-icons/react';

export interface AssetItem {
  id: string;
  versionId: string | null;
  label: string;
  kind: 'image' | 'document' | 'link';
  scope: 'turn' | 'space';
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'tombstoned';
  enabled: boolean;
  selectable: boolean;
}

/**
 * 只展示当前工作区持久化的真实Asset；选择状态决定下一轮消息引用，不改变Asset归属。
 */
export function AssetsDrawer({
  assets,
  onToggle,
}: {
  assets: readonly AssetItem[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-5">
      <p id="assets-availability" className="text-sm text-ink-muted">
        这些资料属于当前工作区；勾选决定下一轮使用哪些来源。PDF会提取文字，当前模型暂不读取图片像素。
      </p>
      {assets.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line bg-surface/60 px-5 py-8 text-center">
          <p className="text-sm font-medium text-ink">还没有资料</p>
          <p className="mt-1 text-xs text-ink-muted">
            上传图片、PDF或网页链接，建立这个笔记本自己的来源集合。
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {assets.map((asset) => (
            <li key={asset.id}>
              <label
                className={`flex min-h-12 items-center gap-3 rounded-2xl border border-line px-4 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
                  asset.selectable
                    ? 'cursor-pointer hover:bg-surface'
                    : 'cursor-not-allowed opacity-70'
                }`}
              >
                <input
                  type="checkbox"
                  checked={asset.enabled}
                  disabled={!asset.selectable}
                  aria-describedby="assets-availability"
                  onChange={() => onToggle(asset.id)}
                  className="size-4 accent-accent"
                />
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-strong text-ink-muted">
                  {asset.status === 'processing' ||
                  asset.status === 'pending' ? (
                    <SpinnerGap className="animate-spin" size={18} />
                  ) : asset.kind === 'link' ? (
                    <LinkSimple size={18} />
                  ) : asset.kind === 'image' ? (
                    <ImageIcon size={18} />
                  ) : (
                    <FilePdf size={18} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {asset.label}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    {asset.kind === 'image'
                      ? '图片'
                      : asset.kind === 'link'
                        ? '网页'
                        : 'PDF'}{' '}
                    · {asset.scope === 'space' ? '笔记本来源' : '仅本轮'} ·{' '}
                    {asset.status === 'ready'
                      ? '已就绪'
                      : asset.status === 'failed'
                        ? '处理失败'
                        : '处理中'}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-2xl bg-surface p-4 text-sm text-ink-muted">
        所有附件都先经过类型、大小、所有权和处理状态校验；浏览器不会接触对象存储地址。
      </div>
    </div>
  );
}
