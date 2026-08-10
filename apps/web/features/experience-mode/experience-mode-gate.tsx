'use client';

import { useState, type ReactNode } from 'react';
import {
  experienceModeSchema,
  type ExperienceMode,
} from './experience-mode-contract';

export function ExperienceModeGate({
  initialMode,
  children,
}: {
  readonly initialMode: ExperienceMode | null;
  readonly children: ReactNode;
}) {
  const [mode, setMode] = useState(initialMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const select = async (next: ExperienceMode) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/experience-mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: next,
          guardianConfirmed: next === 'general',
        }),
      });
      if (!response.ok) throw new Error('mode selection rejected');
      const body = (await response.json()) as { mode?: unknown };
      const result = experienceModeSchema.parse(body.mode);
      setMode(result);
    } catch {
      setError('模式保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  if (mode) return <>{children}</>;

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-5 py-10 text-ink">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="experience-mode-title"
        className="w-full max-w-2xl rounded-[2rem] border border-line bg-card p-7 shadow-[var(--shadow-float)] sm:p-9"
      >
        <p className="text-sm font-medium text-accent">开始使用 EduCanvas</p>
        <h1
          id="experience-mode-title"
          className="mt-2 font-serif text-3xl font-semibold tracking-tight"
        >
          请选择使用模式
        </h1>
        <p className="mt-3 leading-7 text-ink-muted">
          只需选择一次，选择结果会保存在当前浏览器中。
        </p>
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void select('restricted')}
            className="rounded-2xl border border-line bg-surface p-5 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            <span className="block text-lg font-semibold">限制模式</span>
            <span className="mt-2 block text-sm leading-6 text-ink-muted">
              可以使用临时云端语音；音频只用于本次识别，不会留存。
            </span>
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void select('general')}
            className="rounded-2xl border border-accent/35 bg-accent-soft p-5 text-left transition-colors hover:border-accent hover:bg-accent-soft/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            <span className="block text-lg font-semibold">通用模式</span>
            <span className="mt-2 block text-sm leading-6 text-ink-muted">
              选择即表示监护人已同意使用完整的竞赛演示能力。
            </span>
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-bad">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
