'use client';

import { useGSAP } from '@gsap/react';
import {
  CheckCircle,
  Info,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { motionDuration } from '@/features/theme/motion';

gsap.registerPlugin(useGSAP);

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
}

export interface Toast extends ToastInput {
  id: number;
}

/*
 * 模块级订阅、无 context 依赖：任何非组件代码（controller、事件回调）都能直接
 * showToast，挂载 ToastViewport 即开始接收。状态只保存在本模块，SSR 不执行
 * 副作用；auto-dismiss 在浏览器计时器里处理。
 */
let toasts: readonly Toast[] = [];
const listeners = new Set<(next: readonly Toast[]) => void>();
let nextId = 1;
const AUTO_DISMISS_MS = 5_000;

function emit(): void {
  for (const listener of listeners) listener(toasts);
}

export function showToast(input: ToastInput): number {
  const id = nextId;
  nextId += 1;
  toasts = [...toasts, { ...input, id }];
  emit();
  window.setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
  return id;
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

const TONE_ICONS = {
  info: Info,
  success: CheckCircle,
  error: WarningCircle,
} as const;

const TONE_COLORS = {
  info: 'text-accent',
  success: 'text-accent-strong',
  error: 'text-danger',
} as const;

function ToastItem({ toast }: { toast: Toast }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const Icon = TONE_ICONS[toast.tone ?? 'info'];

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          rootRef.current,
          { y: 12, autoAlpha: 0 },
          {
            y: 0,
            autoAlpha: 1,
            duration: motionDuration('fast'),
            ease: 'power2.out',
            clearProps: 'transform',
          },
        );
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );

  return (
    <div
      ref={rootRef}
      role="status"
      className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-line bg-card/95 p-3 shadow-[var(--shadow-float)] backdrop-blur-md"
    >
      <Icon
        aria-hidden="true"
        size={18}
        className={`mt-0.5 shrink-0 ${TONE_COLORS[toast.tone ?? 'info']}`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-xs text-ink-muted">{toast.description}</p>
        ) : null}
        {toast.actionLabel && toast.onAction ? (
          <button
            type="button"
            onClick={() => {
              toast.onAction?.();
              dismissToast(toast.id);
            }}
            className="mt-1 text-xs font-semibold text-accent hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {toast.actionLabel}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="关闭通知"
        onClick={() => dismissToast(toast.id)}
        className="shrink-0 rounded-md p-1 text-ink-muted transition-colors hover:bg-surface-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  );
}

/** 全局通知挂载点：挂一次即可，任何 showToast 调用都会出现在这里。 */
export function ToastViewport() {
  const [items, setItems] = useState<readonly Toast[]>(toasts);

  useEffect(() => {
    const listener = (next: readonly Toast[]) => setItems(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-6 bottom-6 z-50 flex w-80 flex-col gap-2"
    >
      {items.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
