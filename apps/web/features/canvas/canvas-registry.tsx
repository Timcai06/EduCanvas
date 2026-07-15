'use client';

import type {
  PublicArtifact,
  PublicArtifactType,
} from '@educanvas/canvas-protocol';
import { useState, type ComponentType } from 'react';

type ArtifactOf<Type extends PublicArtifactType> = Extract<
  PublicArtifact,
  { type: Type }
>;

type ArtifactRendererRegistry = {
  [Type in PublicArtifactType]: ComponentType<{
    artifact: ArtifactOf<Type>;
  }>;
};

function QuizRenderer({ artifact }: { artifact: ArtifactOf<'quiz'> }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  return (
    <div className="space-y-5">
      {artifact.params.questions.map((question, questionIndex) => (
        <fieldset
          key={question.id}
          className="rounded-xl border border-slate-200 p-4"
        >
          <legend className="px-2 font-medium text-slate-800">
            {questionIndex + 1}. {question.question}
          </legend>
          <div className="mt-3 grid gap-2">
            {question.options.map((option) => {
              const selected = answers[question.id] === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: option.id,
                    }))
                  }
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-900'
                      : 'border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {option.text}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <p className="text-xs text-slate-500">
        客户端只记录选择；正确答案由服务端判分键验证。
      </p>
    </div>
  );
}

function ClassificationGameRenderer({
  artifact,
}: {
  artifact: ArtifactOf<'classification_game'>;
}) {
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  return (
    <div className="space-y-4">
      <p className="text-slate-700">{artifact.params.prompt}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {artifact.params.items.map((item) => (
          <article
            key={item.id}
            className="rounded-xl border border-slate-200 p-3"
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="text-2xl" aria-hidden="true">
                {item.emoji}
              </span>
              <span className="font-medium">{item.label}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {artifact.params.categories.map((category) => {
                const selected = assignments[item.id] === category.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setAssignments((current) => ({
                        ...current,
                        [item.id]: category.id,
                      }))
                    }
                    className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                      selected
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                        : 'border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    {category.label}
                  </button>
                );
              })}
            </div>
          </article>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        已选择 {Object.keys(assignments).length}/{artifact.params.items.length}{' '}
        项；当前仅保存在本页，认证后的服务端提交入口仍待接入。
      </p>
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
}: {
  artifact: PublicArtifact;
}) {
  switch (artifact.type) {
    case 'classification_game': {
      const Renderer = canvasArtifactRegistry.classification_game;
      return <Renderer artifact={artifact} />;
    }
    case 'quiz': {
      const Renderer = canvasArtifactRegistry.quiz;
      return <Renderer artifact={artifact} />;
    }
  }
}
