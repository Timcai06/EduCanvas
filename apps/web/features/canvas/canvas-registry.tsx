'use client';

import type {
  CanvasFeedbackDTO,
  CanvasSubmissionDraft,
} from '@/features/learning/learning-contracts';
import type {
  PipelineFlowSlot,
  PublicArtifact,
  PublicArtifactType,
} from '@educanvas/canvas-protocol';
import {
  CheckCircle,
  GitBranch,
  Image,
  Sparkle,
  type Icon,
} from '@phosphor-icons/react';
import { useId, useState, type ComponentType } from 'react';
import {
  AnimationShell,
  type AnimationClientObservation,
} from './animation-shell';

type ArtifactOf<Type extends PublicArtifactType> = Extract<
  PublicArtifact,
  { type: Type }
>;

interface RendererInteractionProps {
  disabled: boolean;
  feedback: CanvasFeedbackDTO | null;
  onSubmit: (draft: CanvasSubmissionDraft) => void;
  onAnimationObservation?: (
    observation: AnimationClientObservation,
  ) => void;
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

const pipelineSlotPresentation: Record<
  PipelineFlowSlot,
  { eyebrow: string; Icon: Icon }
> = {
  input: { eyebrow: '01 · 数据进入', Icon: Image },
  feature_extraction: { eyebrow: '02 · 信息提炼', Icon: Sparkle },
  classification: { eyebrow: '03 · 模型判断', Icon: GitBranch },
  output: { eyebrow: '04 · 结果呈现', Icon: CheckCircle },
};

export function PipelineFlowRenderer({
  artifact,
  onAnimationObservation,
}: {
  artifact: ArtifactOf<'pipeline_flow'>;
} & RendererInteractionProps) {
  const stepsBySlot = new Map(
    artifact.params.steps.map((step) => [step.slot, step]),
  );
  const orderedSteps = artifact.params.highlightOrder.map((slot) =>
    stepsBySlot.get(slot)!,
  );
  const objectiveId = useId();

  return (
    <AnimationShell
      steps={orderedSteps.map((step) => ({
        id: step.slot,
        label: step.label,
      }))}
      pausePoints={artifact.params.pausePoints}
      onObservation={onAnimationObservation}
    >
      {({ isComplete }) => (
        <section
          aria-labelledby={objectiveId}
          className="overflow-hidden rounded-3xl border border-line/70 bg-[radial-gradient(circle_at_50%_0%,rgba(111,130,255,0.18),transparent_48%),linear-gradient(180deg,rgba(29,31,35,0.96),rgba(11,12,15,0.96))] p-4 shadow-2xl shadow-black/30 sm:p-6"
          data-testid="pipeline-flow"
        >
          <div className="mb-5 max-w-2xl">
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-accent-strong uppercase">
              受控流程演示
            </p>
            <h3
              id={objectiveId}
              className="font-display text-xl font-semibold text-ink sm:text-2xl"
            >
              {artifact.params.objective}
            </h3>
          </div>

          <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {orderedSteps.map((step, index) => {
              const { eyebrow, Icon } = pipelineSlotPresentation[step.slot];
              return (
                <li
                  key={step.slot}
                  data-animation-step={step.slot}
                  className="relative min-h-48 rounded-2xl border border-line/70 bg-canvas/75 p-4 [will-change:transform,opacity] motion-reduce:will-change-auto"
                >
                  <div className="mb-7 flex items-start justify-between gap-3">
                    <span className="text-xs font-medium tracking-wide text-ink-faint">
                      {eyebrow}
                    </span>
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-strong">
                      <Icon aria-hidden="true" size={21} weight="duotone" />
                    </span>
                  </div>
                  <h4 className="font-display text-base font-semibold text-ink">
                    {step.label}
                  </h4>
                  <p className="mt-2 text-sm leading-6 text-ink-muted">
                    {step.narration}
                  </p>
                  {index < orderedSteps.length - 1 ? (
                    <span
                      data-animation-connector=""
                      aria-hidden="true"
                      className="absolute inset-x-4 bottom-3 h-0.5 rounded-full bg-accent [will-change:transform,opacity] motion-reduce:will-change-auto"
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>

          {artifact.params.completionMessage ? (
            <p
              className={`mt-4 min-h-12 rounded-xl border px-4 py-3 text-sm ${
                isComplete
                  ? 'border-good/30 bg-good-soft/70 text-good'
                  : 'border-line/70 bg-canvas/55 text-ink-muted'
              }`}
              aria-live="polite"
              data-testid="pipeline-completion"
            >
              {isComplete
                ? artifact.params.completionMessage
                : '播放到最后一步后，再用自己的话解释这个流程。'}
            </p>
          ) : null}
        </section>
      )}
    </AnimationShell>
  );
}

/**
 * Canvas静态注册表：每新增一种协议类型，TypeScript都会要求同时注册人工审核的Renderer。
 * 注册值只能是本地React组件，模型输出无法提供组件、源码或GSAP指令。
 * 这是阶段一为了安全采用的编译期闭集，不等同于可插拔 Artifact Runtime；后续应由
 * 受信 ArtifactPlugin 同时注册 Schema、公开投影、Renderer 和可选 Grader，但仍禁止
 * 从模型输出或远程内容动态加载可执行代码。
 */
export const canvasArtifactRegistry = {
  classification_game: ClassificationGameRenderer,
  pipeline_flow: PipelineFlowRenderer,
  quiz: QuizRenderer,
} satisfies ArtifactRendererRegistry;

/** 通过判别联合分派受控Renderer；switch保证组件Props保持精确类型。 */
export function CanvasArtifactRenderer({
  artifact,
  disabled,
  feedback,
  onSubmit,
  onAnimationObservation,
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
    case 'pipeline_flow': {
      const Renderer = canvasArtifactRegistry.pipeline_flow;
      return (
        <Renderer
          artifact={artifact}
          disabled={disabled}
          feedback={feedback}
          onSubmit={onSubmit}
          onAnimationObservation={onAnimationObservation}
        />
      );
    }
  }
}
