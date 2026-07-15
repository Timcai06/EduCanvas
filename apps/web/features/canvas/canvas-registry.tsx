'use client';

import type {
  CanvasFeedbackDTO,
  CanvasSubmissionDraft,
} from '@/features/learning/learning-contracts';
import type {
  PublicArtifact,
  PublicArtifactType,
} from '@educanvas/canvas-protocol';
import { useState, type ComponentType } from 'react';

type ArtifactOf<Type extends PublicArtifactType> = Extract<
  PublicArtifact,
  { type: Type }
>;

interface RendererInteractionProps {
  disabled: boolean;
  feedback: CanvasFeedbackDTO | null;
  onSubmit: (draft: CanvasSubmissionDraft) => void;
}

type ArtifactRendererRegistry = {
  [Type in PublicArtifactType]: ComponentType<
    {
      artifact: ArtifactOf<Type>;
    } & RendererInteractionProps
  >;
};

function QuizRenderer({
  artifact,
  disabled,
  feedback,
  onSubmit,
}: {
  artifact: ArtifactOf<'quiz'>;
} & RendererInteractionProps) {
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
                className="min-h-11 rounded-lg bg-accent px-4 py-2 font-medium text-white transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-surface-strong disabled:text-ink-faint"
              >
                {disabled ? '正在提交…' : '提交本题'}
              </button>
              {itemResult ? (
                <span
                  className={
                    itemResult.isCorrect ? 'text-good' : 'text-warn'
                  }
                >
                  {itemResult.isCorrect ? '回答正确' : '还可以再想一想'}
                </span>
              ) : null}
            </div>
          </fieldset>
        );
      })}
      <p className="text-xs text-ink-faint">
        答案由老师批改，做完每道题记得点提交。
      </p>
    </div>
  );
}

function ClassificationGameRenderer({
  artifact,
  disabled,
  feedback,
  onSubmit,
}: {
  artifact: ArtifactOf<'classification_game'>;
} & RendererInteractionProps) {
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const selectedCount = artifact.params.items.filter(
    (item) => assignments[item.id],
  ).length;
  const complete = selectedCount === artifact.params.items.length;

  return (
    <div className="space-y-4">
      <p className="text-ink">{artifact.params.prompt}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {artifact.params.items.map((item) => {
          const itemResult = feedback?.itemResults.find(
            (result) => result.itemId === item.id,
          );
          return (
            <fieldset
              key={item.id}
              className="rounded-2xl border border-line p-3"
              disabled={disabled}
            >
              <legend className="px-1 font-medium">
                <span className="mr-2 text-2xl" aria-hidden="true">
                  {item.emoji}
                </span>
                {item.label}
              </legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {artifact.params.categories.map((category) => {
                  const selected = assignments[item.id] === category.id;
                  return (
                    <label
                      key={category.id}
                      className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-2 ${
                        selected
                          ? 'border-good bg-good-soft text-good'
                          : 'border-line hover:border-ink-faint'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`classification-${artifact.artifactId}-${item.id}`}
                        value={category.id}
                        checked={selected}
                        onChange={() =>
                          setAssignments((current) => ({
                            ...current,
                            [item.id]: category.id,
                          }))
                        }
                        className="size-4 shrink-0 accent-good"
                      />
                      <span>{category.label}</span>
                    </label>
                  );
                })}
              </div>
              {itemResult ? (
                <p
                  className={`mt-2 text-sm ${
                    itemResult.isCorrect ? 'text-good' : 'text-warn'
                  }`}
                >
                  {itemResult.isCorrect ? '分类正确' : '分类不正确，请再观察'}
                </p>
              ) : null}
            </fieldset>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled || !complete}
          onClick={() => {
            if (!complete) return;
            onSubmit({
              type: 'classification_submitted',
              artifactId: artifact.artifactId,
              payload: {
                assignments: artifact.params.items.map((item) => ({
                  itemId: item.id,
                  categoryId: assignments[item.id]!,
                })),
              },
            });
          }}
          className="min-h-11 rounded-lg bg-accent px-4 py-2 font-medium text-white transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-surface-strong disabled:text-ink-faint"
        >
          {disabled ? '正在提交…' : '提交分类'}
        </button>
        <span className="text-sm text-ink-muted">
          已选择 {selectedCount}/{artifact.params.items.length} 项
        </span>
      </div>
    </div>
  );
}

/**
 * Canvas静态注册表：每新增一种协议类型，TypeScript都会要求同时注册人工审核的Renderer。
 * 注册值只能是本地React组件，模型输出无法提供组件、源码或GSAP指令。
 */
export const canvasArtifactRegistry = {
  classification_game: ClassificationGameRenderer,
  quiz: QuizRenderer,
} satisfies ArtifactRendererRegistry;

/** 通过判别联合分派受控Renderer；switch保证组件Props保持精确类型。 */
export function CanvasArtifactRenderer({
  artifact,
  disabled,
  feedback,
  onSubmit,
}: {
  artifact: PublicArtifact;
} & RendererInteractionProps) {
  switch (artifact.type) {
    case 'classification_game': {
      const Renderer = canvasArtifactRegistry.classification_game;
      return (
        <Renderer
          artifact={artifact}
          disabled={disabled}
          feedback={feedback}
          onSubmit={onSubmit}
        />
      );
    }
    case 'quiz': {
      const Renderer = canvasArtifactRegistry.quiz;
      return (
        <Renderer
          artifact={artifact}
          disabled={disabled}
          feedback={feedback}
          onSubmit={onSubmit}
        />
      );
    }
  }
}
