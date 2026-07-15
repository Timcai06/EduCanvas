'use client';

import type {
  CanvasFeedbackDTO,
  CanvasSubmissionDraft,
} from '@/features/learning/learning-contracts';
import {
  getFocusableElements,
  makeWorkspaceBackgroundInert,
} from '@/features/workspace/modal-focus';
import type { PublicArtifact } from '@educanvas/canvas-protocol';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { CanvasArtifactRenderer } from './canvas-registry';

/**
 * Canvas 协作面板：包裹受控 Renderer 注册表，提供收起/全屏工具与判分反馈区。
 * 只接收服务端公开投影；模型不能注入 HTML、JavaScript 或 GSAP 源码（ADR-0002）。
 * 窄屏下面板以全屏页呈现，滚动位置的保存与恢复由 LearnWorkspace 负责。
 */
export function CanvasPanel({
  artifact,
  feedback,
  errorMessage,
  isPending,
  isFull,
  onSubmit,
  onCollapse,
  onToggleFull,
}: {
  artifact: PublicArtifact;
  feedback: CanvasFeedbackDTO | null;
  errorMessage: string | null;
  isPending: boolean;
  isFull: boolean;
  onSubmit: (draft: CanvasSubmissionDraft) => void;
  onCollapse: () => void;
  onToggleFull: () => void;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [isCompact, setIsCompact] = useState(false);
  const isModal = isFull || isCompact;

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(rootRef.current, {
          x: 32,
          autoAlpha: 0,
          duration: 0.32,
          ease: 'power2.out',
        });
      });
    },
    { scope: rootRef },
  );

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCollapse();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const opener = openerRef.current;
      queueMicrotask(() => opener?.focus());
    };
  }, [onCollapse]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isModal) return;
    const root = rootRef.current;
    if (!root) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.focus();
    const restoreBackground = makeWorkspaceBackgroundInert(root);

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(root);
      if (focusable.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === root)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);

    return () => {
      document.removeEventListener('keydown', trapFocus);
      restoreBackground();
      document.body.style.overflow = previousOverflow;
    };
  }, [isModal]);

  return (
    <section
      ref={rootRef}
      role={isModal ? 'dialog' : 'region'}
      aria-label="教学Canvas"
      aria-modal={isModal || undefined}
      aria-busy={isPending}
      tabIndex={-1}
      className={`${
        isFull
          ? 'fixed inset-0 z-40 p-0 lg:p-4'
          : 'fixed inset-0 z-40 lg:static lg:z-auto lg:min-w-0 lg:flex-1 lg:p-3 lg:pl-0'
      } flex flex-col bg-surface/60 backdrop-blur-sm lg:bg-transparent lg:backdrop-blur-none`}
    >
      <div className="flex min-h-0 flex-1 flex-col bg-canvas shadow-[var(--shadow-float)] lg:rounded-3xl lg:border lg:border-line">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3 lg:px-5">
          <h2 className="font-display min-w-0 flex-1 truncate text-base font-semibold text-ink">
            {artifact.title}
          </h2>
          <button
            type="button"
            onClick={onToggleFull}
            aria-label={isFull ? '退出全屏' : '全屏'}
            className="hidden min-h-9 items-center rounded-full px-3 text-sm text-ink-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:flex"
          >
            {isFull ? '退出全屏' : '全屏'}
          </button>
          <button
            type="button"
            onClick={onCollapse}
            aria-label="收起演示，返回对话"
            className="flex min-h-9 items-center rounded-full px-3 text-sm text-ink-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            返回对话
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
          <CanvasArtifactRenderer
            key={`${artifact.schemaVersion}:${artifact.artifactId}`}
            artifact={artifact}
            disabled={isPending}
            feedback={feedback}
            onSubmit={onSubmit}
          />
          <div className="mt-4 min-h-6" aria-live="polite" aria-atomic="true">
            {feedback ? (
              <p role="status" className="font-medium text-ink">
                本次答对 {feedback.correctItems}/{feedback.attemptedItems} 项
                {feedback.message ? `：${feedback.message}` : null}
              </p>
            ) : null}
            {isPending ? (
              <p role="status" className="text-accent-strong">
                老师正在批改…
              </p>
            ) : null}
          </div>
          {errorMessage ? (
            <p
              role="alert"
              className="mt-2 rounded-xl bg-bad-soft p-3 text-bad"
            >
              {errorMessage}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
