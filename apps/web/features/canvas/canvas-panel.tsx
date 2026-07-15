'use client';

import type {
  CanvasFeedbackDTO,
  CanvasSubmissionDraft,
} from '@/features/learning/learning-contracts';
import type { PublicArtifact } from '@educanvas/canvas-protocol';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef } from 'react';
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

  return (
    <section
      ref={rootRef}
      aria-label="教学Canvas"
      aria-busy={isPending}
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
