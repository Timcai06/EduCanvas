'use client';

export interface AssetItem {
  id: string;
  label: string;
  kind: '课程资料' | '我的上传' | '链接';
  enabled: boolean;
}

/**
 * 知识资产抽屉：展示、启用/停用本课资料。阶段一为演示数据，上传与解析链路
 * 尚未建设；入口保留但引导为「即将开放」，不伪装成已生效能力。
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
      <p className="text-sm text-ink-muted">
        勾选的资料会成为老师讲解和出题的依据，回答里会标注来源。
      </p>
      <ul className="space-y-2">
        {assets.map((asset) => (
          <li key={asset.id}>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-line px-4 py-2.5 transition-colors hover:bg-surface has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent">
              <input
                type="checkbox"
                checked={asset.enabled}
                onChange={() => onToggle(asset.id)}
                className="size-4 accent-accent"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">
                  {asset.label}
                </span>
                <span className="block text-xs text-ink-faint">
                  {asset.kind}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl bg-surface p-4 text-sm text-ink-muted">
        上传文件、图片和添加链接即将开放；到时候它们也会出现在这里。
      </div>
    </div>
  );
}
