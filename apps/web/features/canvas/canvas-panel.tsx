'use client';

import type {
  CanvasFeedbackDTO,
  CanvasSubmissionDraft,
} from '@/features/learning/learning-contracts';
import type { PublicArtifact } from '@educanvas/canvas-protocol';
import { CanvasHost } from './canvas-host';
import { CanvasArtifactRenderer } from './canvas-registry';

/**
 * 判分型(Tier 1)Canvas 内容:受控 Renderer 注册表 + 判分反馈区。
 * 只接收服务端公开投影;模型不能注入 HTML、JavaScript 或 GSAP 源码(ADR-0010 Tier 1)。
 * 分栏/全屏/dialog 语义由共享 CanvasHost 提供。
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
  return (
    <CanvasHost
      ariaLabel="教学Canvas"
      title={artifact.title}
      closeLabel="返回对话"
      closeAriaLabel="收起演示，返回对话"
      onClose={onCollapse}
      isFull={isFull}
      onToggleFull={onToggleFull}
      isPending={isPending}
    >
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
          <p role="alert" className="mt-2 rounded-xl bg-bad-soft p-3 text-bad">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </CanvasHost>
  );
}
