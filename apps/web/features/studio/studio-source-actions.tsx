'use client';

import { Check, PencilSimple, TrashSimple, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { AssetItem } from '@/features/assets/assets-drawer';

/**
 * 当前居中来源的动作气泡。
 *
 * 为什么动作不放进滚轮条目里：滚轮是 `role="listbox"`，option 内部嵌可聚焦的
 * 破坏性按钮会破坏 listbox 的键盘与读屏语义。气泡是独立的 `role="group"`，
 * 滚轮保持纯导航。设计约束见 docs/01-product/02-学生界面规范.md（Studio 不用
 * dialog、遮罩或焦点陷阱），所以重命名用内联输入、删除用两步确认而不是弹窗。
 *
 * 可见动作一律来自服务端授权过的 `resource.allowedActions`；没有资源描述时
 * 只剩启停——启停是成员私有绑定，不属于资源动作。
 */
export function StudioSourceActions({
  asset,
  onToggleEnabled,
  onRename,
  onDelete,
}: {
  asset: AssetItem;
  onToggleEnabled: (asset: AssetItem) => void;
  onRename: (asset: AssetItem, displayName: string) => void;
  onDelete: (asset: AssetItem) => void;
}) {
  /* 切换到另一个来源时由调用方按 asset.id 重挂载本组件来复位，
     否则「确认删除」的中间态会挪到新条目上。这里不需要同步 effect。 */
  const [mode, setMode] = useState<'idle' | 'renaming' | 'confirming'>('idle');
  const [draft, setDraft] = useState(asset.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === 'renaming') inputRef.current?.select();
  }, [mode]);

  const actions = asset.resource?.allowedActions ?? [];
  const canRename = actions.includes('rename');
  const canDelete = actions.includes('delete');
  const canToggle = asset.selectable;

  if (mode === 'renaming') {
    return (
      <form
        className="studio-actions"
        onSubmit={(event) => {
          event.preventDefault();
          const next = draft.trim();
          if (next && next !== asset.label) onRename(asset, next);
          setMode('idle');
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMode('idle');
          }}
          maxLength={300}
          aria-label="来源名称"
          className="studio-actions__input"
        />
        <button
          type="submit"
          aria-label="保存名称"
          className="studio-actions__button"
        >
          <Check size={15} />
        </button>
        <button
          type="button"
          aria-label="取消重命名"
          onClick={() => setMode('idle')}
          className="studio-actions__button"
        >
          <X size={15} />
        </button>
      </form>
    );
  }

  return (
    <div
      role="group"
      aria-label={`${asset.label} 的操作`}
      className="studio-actions"
    >
      {canToggle ? (
        <button
          type="button"
          aria-pressed={asset.enabled}
          onClick={() => onToggleEnabled(asset)}
          className="studio-actions__button studio-actions__button--wide"
        >
          {asset.enabled ? '停用' : '启用'}
        </button>
      ) : null}
      {canRename ? (
        <button
          type="button"
          aria-label="重命名来源"
          onClick={() => {
            setDraft(asset.label);
            setMode('renaming');
          }}
          className="studio-actions__button"
        >
          <PencilSimple size={15} />
        </button>
      ) : null}
      {canDelete ? (
        mode === 'confirming' ? (
          <>
            <button
              type="button"
              onClick={() => {
                onDelete(asset);
                setMode('idle');
              }}
              className="studio-actions__button studio-actions__button--danger studio-actions__button--wide"
            >
              确认删除
            </button>
            <button
              type="button"
              aria-label="取消删除"
              onClick={() => setMode('idle')}
              className="studio-actions__button"
            >
              <X size={15} />
            </button>
          </>
        ) : (
          <button
            type="button"
            aria-label="删除来源"
            onClick={() => setMode('confirming')}
            className="studio-actions__button"
          >
            <TrashSimple size={15} />
          </button>
        )
      ) : null}
    </div>
  );
}
