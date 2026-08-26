'use client';

import { GradeMark } from '@/components/two-pen-marks';
import type {
  CanvasFeedbackDTO,
  CanvasSubmissionDraft,
} from '@/features/learning/learning-contracts';
import type { PublicArtifact } from '@educanvas/canvas-protocol';
import { useState } from 'react';

type QuizArtifact = Extract<PublicArtifact, { type: 'quiz' }>;

export function QuizRenderer({
  artifact,
  disabled,
  feedback,
  onSubmit,
}: {
  artifact: QuizArtifact;
  disabled: boolean;
  feedback: CanvasFeedbackDTO | null;
  onSubmit: (draft: CanvasSubmissionDraft) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  return (
    <div className="space-y-5">
      {artifact.params.questions.map((question, questionIndex) => {
        const selectedOptionId = answers[question.id];
        const itemResult = feedback?.itemResults.find(
          (result) => result.itemId === question.id,
        );

        return (
          <fieldset
            key={question.id}
            className="rounded-2xl border border-line p-4"
            disabled={disabled}
          >
            <legend className="px-2 font-medium text-ink">
              {questionIndex + 1}. {question.question}
            </legend>
            <div className="mt-3 grid gap-2">
              {question.options.map((option) => {
                const selected = selectedOptionId === option.id;
                return (
                  <label
                    key={option.id}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-2 ${
                      selected
                        ? 'border-accent bg-accent-soft text-accent-strong'
                        : 'border-line hover:border-ink-faint'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`quiz-${artifact.artifactId}-${question.id}`}
                      value={option.id}
                      checked={selected}
                      onChange={() =>
                        setAnswers((current) => ({
                          ...current,
                          [question.id]: option.id,
                        }))
                      }
                      className="size-5 shrink-0 accent-accent"
                    />
                    <span>{option.text}</span>
                  </label>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={disabled || !selectedOptionId}
                onClick={() => {
                  if (!selectedOptionId) return;
                  onSubmit({
                    type: 'quiz_answer_submitted',
                    artifactId: artifact.artifactId,
                    payload: {
                      questionId: question.id,
                      selectedOptionId,
                    },
                  });
                }}
                className="min-h-11 rounded-lg bg-accent px-4 py-2 font-medium text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-surface-strong disabled:text-ink-faint"
              >
                {disabled ? '正在提交…' : '提交本题'}
              </button>
              {itemResult ? (
                <span className="inline-flex items-center gap-1.5 text-ink-muted">
                  <GradeMark correct={itemResult.isCorrect} />
                  {itemResult.isCorrect ? '回答正确' : '还可以再想一想'}
                </span>
              ) : null}
            </div>
          </fieldset>
        );
      })}
      <p className="text-xs text-ink-muted">
        答案由老师批改，做完每道题记得点提交。
      </p>
    </div>
  );
}
