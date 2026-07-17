'use client';

import { ArrowRight, PresentationChart } from '@phosphor-icons/react';

export interface StudioOutput {
  id: string;
  title: string;
  kind: string;
  status: '本课预置' | '已完成';
}

/**
 * 本课产物抽屉：阶段一只有课程预置分类互动，不把它描述成 AI 已生成产物。
 * 打开后进入 Chat+Canvas 协作态，由 LearnWorkspace 装载受控 Artifact。
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
        这里收纳本课可用的互动与学习成果；当前互动由课程预置。
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
                <PresentationChart
                  aria-hidden="true"
                  size={21}
                  weight="regular"
                />
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
                <span className="inline-flex items-center gap-1">
                  打开
                  <ArrowRight aria-hidden="true" size={14} weight="bold" />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl bg-surface p-4 text-sm text-ink-muted">
        AI 生成 Slide、讲解动画等能力尚未开放。
      </div>
    </div>
  );
}
