'use client';

import { createStudyPlanAction } from '@/app/learn/actions';
import type {
  CreateStudyPlanInputDTO,
  StudyActionResultDTO,
} from '@/features/learning/learning-contracts';
import { ArrowRight, ShieldCheck } from '@phosphor-icons/react';
import { useState, useTransition } from 'react';
import { TopBar } from '../workspace/learning/top-bar';

const initialInput: CreateStudyPlanInputDTO = {
  ageBand: 'unknown',
  gradeBand: 'primary_school',
  declarationSource: 'self_declared',
  desiredOutcome: '理解图像 AI 如何根据特征完成分类',
  preferences: {
    explanationOrder: 'example_first',
    responseDepth: 'balanced',
    guidance: 'step_by_step',
    modality: 'mixed',
    feedbackStyle: 'balanced',
  },
};

function errorMessage(result: StudyActionResultDTO): string {
  return result.message;
}

/** K12 学习入口只收集可验证声明；所有选项都可由学生或监护人重新修改。 */
export function StudySetup() {
  const [input, setInput] = useState(initialInput);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createStudyPlanAction(input);
      setError(errorMessage(result));
    });
  };

  return (
    <main className="min-h-dvh bg-canvas text-ink">
      <TopBar courseTitle="" stageLabel={null} masteryPercent={null} quiet />
      <div className="mx-auto grid w-full max-w-5xl gap-8 px-5 py-8 lg:grid-cols-[0.8fr_1.2fr] lg:py-14">
        <section className="self-center">
          <p className="mb-3 text-sm font-semibold tracking-wide text-accent-strong">
            建立你的学习 Notebook
          </p>
          <h1 className="max-w-xl text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-5xl">
            先说目标，再由 AI 老师决定从哪里开始。
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-ink-muted">
            我们只使用你明确填写的年龄段、年级和教学偏好，不根据聊天内容猜测年龄或性格。
          </p>
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-line bg-surface/70 p-4 text-sm leading-6 text-ink-muted">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-accent-strong"
              size={20}
            />
            年龄未知时默认采用更保守的未成年人安全策略；偏好只改变讲解方式，不会放宽权限。
          </div>
        </section>

        <form
          className="rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-7"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">
              学习者年龄段
              <select
                value={input.ageBand}
                onChange={(event) =>
                  setInput((current) => ({
                    ...current,
                    ageBand: event.target
                      .value as CreateStudyPlanInputDTO['ageBand'],
                  }))
                }
                className="min-h-11 rounded-xl border border-line bg-canvas px-3 outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="under_13">12 岁及以下</option>
                <option value="13_to_15">13–15 岁</option>
                <option value="16_to_17">16–17 岁</option>
                <option value="adult">成年人</option>
                <option value="unknown">暂不确定</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              当前学段
              <select
                value={input.gradeBand}
                onChange={(event) =>
                  setInput((current) => ({
                    ...current,
                    gradeBand: event.target
                      .value as CreateStudyPlanInputDTO['gradeBand'],
                  }))
                }
                className="min-h-11 rounded-xl border border-line bg-canvas px-3 outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="primary_school">小学</option>
                <option value="middle_school">初中</option>
                <option value="high_school">高中</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium sm:col-span-2">
              这份信息由谁填写
              <select
                value={input.declarationSource}
                onChange={(event) =>
                  setInput((current) => ({
                    ...current,
                    declarationSource: event.target
                      .value as CreateStudyPlanInputDTO['declarationSource'],
                  }))
                }
                className="min-h-11 rounded-xl border border-line bg-canvas px-3 outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="self_declared">学习者本人</option>
                <option value="guardian_declared">家长或监护人</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium sm:col-span-2">
              这次想学会什么
              <textarea
                value={input.desiredOutcome}
                maxLength={500}
                rows={3}
                onChange={(event) =>
                  setInput((current) => ({
                    ...current,
                    desiredOutcome: event.target.value,
                  }))
                }
                className="resize-none rounded-xl border border-line bg-canvas px-3 py-2.5 leading-6 outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              讲解顺序
              <select
                value={input.preferences.explanationOrder}
                onChange={(event) =>
                  setInput((current) => ({
                    ...current,
                    preferences: {
                      ...current.preferences,
                      explanationOrder: event.target
                        .value as CreateStudyPlanInputDTO['preferences']['explanationOrder'],
                    },
                  }))
                }
                className="min-h-11 rounded-xl border border-line bg-canvas px-3 outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="example_first">先看例子</option>
                <option value="concept_first">先讲概念</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              练习引导
              <select
                value={input.preferences.guidance}
                onChange={(event) =>
                  setInput((current) => ({
                    ...current,
                    preferences: {
                      ...current.preferences,
                      guidance: event.target
                        .value as CreateStudyPlanInputDTO['preferences']['guidance'],
                    },
                  }))
                }
                className="min-h-11 rounded-xl border border-line bg-canvas px-3 outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="step_by_step">分步引导</option>
                <option value="independent_first">先独立尝试</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              回答详略
              <select
                value={input.preferences.responseDepth}
                onChange={(event) =>
                  setInput((current) => ({
                    ...current,
                    preferences: {
                      ...current.preferences,
                      responseDepth: event.target
                        .value as CreateStudyPlanInputDTO['preferences']['responseDepth'],
                    },
                  }))
                }
                className="min-h-11 rounded-xl border border-line bg-canvas px-3 outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="concise">简洁要点</option>
                <option value="balanced">适中展开</option>
                <option value="detailed">详细讲解</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              内容形式
              <select
                value={input.preferences.modality}
                onChange={(event) =>
                  setInput((current) => ({
                    ...current,
                    preferences: {
                      ...current.preferences,
                      modality: event.target
                        .value as CreateStudyPlanInputDTO['preferences']['modality'],
                    },
                  }))
                }
                className="min-h-11 rounded-xl border border-line bg-canvas px-3 outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="mixed">图文与练习结合</option>
                <option value="visual">多用图示</option>
                <option value="text">以文字为主</option>
                <option value="practice">以练习为主</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium sm:col-span-2">
              反馈方式
              <select
                value={input.preferences.feedbackStyle}
                onChange={(event) =>
                  setInput((current) => ({
                    ...current,
                    preferences: {
                      ...current.preferences,
                      feedbackStyle: event.target
                        .value as CreateStudyPlanInputDTO['preferences']['feedbackStyle'],
                    },
                  }))
                }
                className="min-h-11 rounded-xl border border-line bg-canvas px-3 outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="gentle">鼓励式反馈</option>
                <option value="balanced">鼓励与纠正并重</option>
                <option value="direct">直接指出问题</option>
              </select>
            </label>
          </div>

          {error ? (
            <p role="alert" className="mt-4 text-sm text-cinnabar">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isPending || input.desiredOutcome.trim().length === 0}
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? '正在建立 Notebook…' : '开始短诊断'}
            {!isPending ? <ArrowRight aria-hidden="true" size={18} /> : null}
          </button>
        </form>
      </div>
    </main>
  );
}
