'use client';

export interface AssetItem {
  id: string;
  label: string;
  kind: '课程资料' | '我的上传' | '链接';
  enabled: boolean;
  /** 只有真实检索与引用链路接通后，资料才允许加入本轮上下文。 */
  selectable: boolean;
}

/**
 * 知识资产抽屉：当前只展示本课预置资料目录。检索与引用链路尚未建设时，
 * 选择控件明确禁用，不能产生上下文标签或暗示资料已经用于回答。
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
        本课资料接入后，老师才能基于资料回答并标注来源；当前仅供预览。
      </p>
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
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">
                  {asset.label}
                </span>
                <span className="block text-xs text-ink-faint">
                  {asset.kind} · {asset.selectable ? '可选择' : '尚未接入'}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl bg-surface p-4 text-sm text-ink-muted">
        上传文件、图片和添加链接尚未开放；开放后会先完成解析与来源校验。
      </div>
    </div>
  );
}
