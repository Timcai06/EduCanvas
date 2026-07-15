'use client';

import type {
  CanvasFeedbackDTO,
  CanvasSubmissionDraft,
} from '@/features/learning/learning-contracts';
import type { PublicArtifact } from '@educanvas/canvas-protocol';
import { CanvasArtifactRenderer } from './canvas-registry';

/**
 * Canvas只接收服务端公开投影并分派到受控注册表；模型不能注入HTML、JavaScript或GSAP源码。
 */
export function CanvasStage({
  artifact,
  feedback,
  errorMessage,
  isPending,
  onSubmit,
}: {
  artifact: PublicArtifact;
  feedback: CanvasFeedbackDTO | null;
  errorMessage: string | null;
  isPending: boolean;
  onSubmit: (draft: CanvasSubmissionDraft) => void;
}) {
  return (
    <div className="flex h-full flex-col" aria-busy={isPending}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">教学 Canvas</h2>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
          受控组件 · {artifact.type}
        </span>
      </div>
      <div className="flex-1 rounded-lg border border-slate-300 p-4 text-sm">
        <h3 className="mb-4 text-base font-semibold text-slate-900">
          {artifact.title}
        </h3>
        <CanvasArtifactRenderer
          key={`${artifact.schemaVersion}:${artifact.artifactId}`}
          artifact={artifact}
          disabled={isPending}
          feedback={feedback}
          onSubmit={onSubmit}
        />
        <div className="mt-4 min-h-6" aria-live="polite" aria-atomic="true">
          {feedback ? (
            <p role="status" className="font-medium text-slate-800">
              本次答对 {feedback.correctItems}/{feedback.attemptedItems} 项
              {feedback.message ? `：${feedback.message}` : null}
            </p>
          ) : null}
          {isPending ? (
            <p role="status" className="text-indigo-700">
              正在由服务端判分…
            </p>
          ) : null}
        </div>
        {errorMessage ? (
          <p
            role="alert"
            className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800"
          >
            {errorMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
