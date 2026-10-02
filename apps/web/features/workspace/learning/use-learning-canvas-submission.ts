'use client';
import { useCallback, useRef, useState, useTransition } from 'react';
import type {
  CanvasFeedbackDTO,
  CanvasSubmissionDraft,
  CanvasSubmissionInput,
  LearningPageDTO,
} from '@/features/learning/learning-contracts';
import { createCanvasSubmissionInput } from '@/features/learning/canvas-submission';
import type { submitCanvasAction } from '@/app/learn/actions';
interface RetryableSubmission {
  fingerprint: string;
  input: CanvasSubmissionInput;
}

/** 重试复用同一次提交ID，Notebook绑定的Server Action只影响授权定位。 */
export function useLearningCanvasSubmission(
  initialProgress: LearningPageDTO['progress'],
  submitCanvas: typeof submitCanvasAction,
) {
  const [progress, setProgress] = useState(initialProgress);
  const [feedback, setFeedback] = useState<CanvasFeedbackDTO | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const retryableSubmission = useRef<RetryableSubmission | null>(null);

  const handleSubmit = useCallback(
    (draft: CanvasSubmissionDraft) => {
      const fingerprint = JSON.stringify(draft);
      const previous = retryableSubmission.current;
      const input =
        previous?.fingerprint === fingerprint
          ? previous.input
          : createCanvasSubmissionInput(draft);

      retryableSubmission.current = { fingerprint, input };
      setErrorMessage(null);

      startTransition(async () => {
        try {
          const result = await submitCanvas(input);
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
    },
    [submitCanvas],
  );

  return { progress, feedback, errorMessage, isPending, handleSubmit };
}
