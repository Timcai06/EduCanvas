'use client';

import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { useState } from 'react';

export function normalizeDeepResearchTopic(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  return [...normalized].slice(0, 1_000).join('');
}

export function DeepResearchLauncher({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (topic: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('');
  const submit = () => {
    const normalized = normalizeDeepResearchTopic(topic);
    if (!normalized || busy) return;
    setTopic('');
    setOpen(false);
    onSubmit(normalized);
  };

  return (
    <>
      <div className="mt-2 flex px-1">
        <button
          type="button"
          aria-label="深度研究"
          disabled={busy}
          onClick={() => setOpen(true)}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-surface/75 px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <MagnifyingGlass aria-hidden="true" size={15} />
          深度研究
        </button>
      </div>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="开始深度研究"
          className="fixed inset-0 z-50 grid place-items-center bg-ink/25 px-4"
        >
          <div className="w-full max-w-lg rounded-3xl border border-line bg-card p-5 shadow-[var(--shadow-float)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">
                  深度研究
                </h2>
                <p className="mt-1 text-sm leading-6 text-ink-muted">
                  系统会进行三轮搜索，并把实际读取的网页保存为当前笔记本来源。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭深度研究"
                onClick={() => setOpen(false)}
                className="grid size-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-ink">
                研究主题
              </span>
              <textarea
                autoFocus
                rows={4}
                maxLength={1_000}
                value={topic}
                onChange={(event) => setTopic(event.currentTarget.value)}
                placeholder="例如：光合作用的研究进展"
                className="ec-input w-full resize-y rounded-2xl px-4 py-3 text-sm text-ink"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-10 rounded-full border border-line px-4 text-sm font-medium text-ink-muted"
              >
                取消
              </button>
              <button
                type="button"
                disabled={normalizeDeepResearchTopic(topic) === null}
                onClick={submit}
                className="min-h-10 rounded-full bg-accent px-4 text-sm font-medium text-card disabled:cursor-not-allowed disabled:bg-surface-strong disabled:text-ink-faint"
              >
                开始研究
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
