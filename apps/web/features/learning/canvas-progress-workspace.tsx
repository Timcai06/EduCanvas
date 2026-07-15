'use client';

import { submitCanvasAction } from '@/app/learn/actions';
import { CanvasStage } from '@/features/canvas/canvas-stage';
import { ProgressPanel } from '@/features/progress/progress-panel';
import { CANVAS_INTERACTION_SCHEMA_VERSION } from '@educanvas/canvas-protocol';
import { useCallback, useRef, useState, useTransition } from 'react';
import type {
  CanvasFeedbackDTO,
  CanvasSubmissionDraft,
  CanvasSubmissionInput,
  LearningPageDTO,
} from './learning-contracts';

interface RetryableSubmission {
  fingerprint: string;
  input: CanvasSubmissionInput;
}

function createSubmissionInput(
  draft: CanvasSubmissionDraft,
): CanvasSubmissionInput {
  const eventBase = {
    schemaVersion: CANVAS_INTERACTION_SCHEMA_VERSION,
    eventId: crypto.randomUUID(),
    artifactId: draft.artifactId,
    occurredAt: new Date().toISOString(),
  };

  if (draft.type === 'quiz_answer_submitted') {
    return {
      ...eventBase,
      type: draft.type,
      payload: { ...draft.payload },
    };
  }

  return {
    ...eventBase,
    type: draft.type,
    payload: {
      assignments: draft.payload.assignments.map((assignment) => ({
        ...assignment,
      })),
    },
  };
}

/** Canvas与进度共享最小客户端状态；可信判分和掌握度仍全部来自Server Action。 */
export function CanvasProgressWorkspace({
  initialData,
}: {
  initialData: LearningPageDTO;
}) {
  const [progress, setProgress] = useState(initialData.progress);
  const [feedback, setFeedback] = useState<CanvasFeedbackDTO | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const retryableSubmission = useRef<RetryableSubmission | null>(null);

  const handleSubmit = useCallback((draft: CanvasSubmissionDraft) => {
    const fingerprint = JSON.stringify(draft);
    const previous = retryableSubmission.current;
    const input =
      previous?.fingerprint === fingerprint
        ? previous.input
        : createSubmissionInput(draft);

    retryableSubmission.current = { fingerprint, input };
    setErrorMessage(null);

    startTransition(async () => {
      try {
        const result = await submitCanvasAction(input);
        if (result.status === 'success') {
          retryableSubmission.current = null;
          setFeedback(result.feedback);
          setProgress(result.progress);
          return;
        }
        setErrorMessage(result.message);
      } catch {
        setErrorMessage('提交暂时失败，请检查网络后重试。');
      }
    });
  }, []);

  return (
    <>
      <section
        className="min-h-[24rem] bg-white p-4 lg:min-h-0 lg:overflow-y-auto"
        aria-label="教学Canvas"
      >
        <CanvasStage
          artifact={initialData.artifact}
          feedback={feedback}
          errorMessage={errorMessage}
          isPending={isPending}
          onSubmit={handleSubmit}
        />
      </section>
      <section
        className="min-h-[18rem] bg-white p-4 lg:min-h-0 lg:overflow-y-auto"
        aria-label="学习进度"
      >
        <ProgressPanel progress={progress} />
      </section>
    </>
  );
}
