'use client';

export interface StudioOutput {
  id: string;
  title: string;
  kind: string;
  status: '已生成' | '已完成';
}

/**
 * 本课产物抽屉：聚合本节课生成过的教学产物。阶段一只有当前分类游戏一件产物；
 * 打开产物即进入 Chat+Canvas 协作态，由 LearnWorkspace 装载对应 Artifact。
 */
export function StudioDrawer({
  outputs,
  onOpen,
}: {
  outputs: readonly StudioOutput[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">
        老师为你生成过的演示、测验都收在这里，随时可以重新打开。
      </p>
      <ul className="space-y-2">
        {outputs.map((output) => (
          <li key={output.id}>
            <button
              type="button"
              onClick={() => onOpen(output.id)}
              className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line p-3 text-left transition-colors hover:border-accent/40 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft font-semibold text-accent"
              >
                ◫
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">
                  {output.title}
                </span>
                <span className="block text-xs text-ink-muted">
                  {output.kind} ·{' '}
                  <span
                    className={
                      output.status === '已完成' ? 'text-good' : undefined
                    }
                  >
                    {output.status}
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-accent">
                打开 ›
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl bg-surface p-4 text-sm text-ink-muted">
        Slide、讲解动画等更多产物类型即将开放。
      </div>
    </div>
  );
}
