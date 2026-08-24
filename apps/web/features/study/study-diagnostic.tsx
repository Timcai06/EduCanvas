'use client';

import { submitDiagnosticAction } from '@/app/learn/actions';
import type {
  StudyActionResultDTO,
  StudyDiagnosticDTO,
} from '@/features/learning/learning-contracts';
import { ArrowLeft, ArrowRight, CheckCircle } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { BlurText } from '@/components/BlurText';
import { useReducedMotion } from '@/features/workspace/shared/use-reduced-motion';
import { TopBar } from '../workspace/learning/top-bar';

/** 短诊断只保存选择；浏览器既看不到正确答案，也不能提交自报分数。 */
export function StudyDiagnostic({ data }: { data: StudyDiagnosticDTO }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const reducedMotion = useReducedMotion();
  const [currentStep, setCurrentStep] = useState(0);

  const questions = data.diagnostic.questions;
  const total = questions.length;
  const currentQuestion = questions[currentStep]!;
  const currentAnswered = Boolean(answers[currentQuestion.questionId]);
  const answeredCount = useMemo(
    () => questions.filter((question) => answers[question.questionId]).length,
    [answers, questions],
  );
  const allAnswered = answeredCount === total;

  const select = (questionId: string, optionId: string) => {
    setAnswers((current) => ({ ...current, [questionId]: optionId }));
  };
  const goNext = () => {
    setCurrentStep((step) => Math.min(step + 1, total - 1));
  };
  const goBack = () => {
    setCurrentStep((step) => Math.max(step - 1, 0));
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result: StudyActionResultDTO = await submitDiagnosticAction({
        attemptId: crypto.randomUUID(),
        answers: questions.map((question) => ({
          questionId: question.questionId,
          selectedOptionId: answers[question.questionId] ?? '',
        })),
      });
      setError(result.message);
    });
  };

  const stepVariants = {
    enter: { x: 24, opacity: 0 },
    center: { x: 0, opacity: 1 },
    exit: { x: -24, opacity: 0 },
  };

  return (
    <main className="min-h-dvh bg-canvas text-ink">
      <TopBar
        courseTitle={data.topic}
        stageLabel="短诊断"
        masteryPercent={null}
      />
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-12">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          返回对话
        </Link>
        <div className="mb-8">
          <p className="text-sm font-semibold text-accent-strong">
            {answeredCount}/{total} 已完成
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">
            <BlurText
              as="span"
              text="找到最适合你的起点"
              delay={0.35}
              className=""
            />
          </h1>
          <p className="mt-3 leading-7 text-ink-muted">
            目标：{data.desiredOutcome}
            。不知道也没关系，结果只用于区分优势、重点和待学习内容。
          </p>
        </div>

        {/* 逐步 Stepper 指示条：可回看已答步骤，当前步高亮 */}
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={currentStep + 1}
          aria-label="诊断进度"
          className="mb-6 flex items-center gap-1.5"
        >
          {questions.map((question, index) => {
            const isDone = Boolean(
              answers[question.questionId] && index <= currentStep,
            );
            const isActive = index === currentStep;
            const dotClass = isActive
              ? 'size-3 rounded-full bg-accent ring-4 ring-accent-soft'
              : isDone
                ? 'size-2.5 rounded-full bg-accent'
                : 'size-2.5 rounded-full border border-line bg-card';
            return (
              <button
                key={question.questionId}
                type="button"
                aria-label={`第 ${index + 1} 题${isDone ? '（已答）' : ''}`}
                aria-current={isActive ? 'step' : undefined}
                onClick={() => setCurrentStep(index)}
                className="min-w-6 rounded-full py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                <span aria-hidden="true" className={dotClass} />
              </button>
            );
          })}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="relative overflow-hidden">
            <AnimatePresence initial={false} mode="wait" custom={currentStep}>
              <motion.fieldset
                key={currentQuestion.questionId}
                className="rounded-3xl border border-line bg-surface p-5 sm:p-6"
                variants={stepVariants}
                initial={reducedMotion ? undefined : 'enter'}
                animate={reducedMotion ? undefined : 'center'}
                exit={reducedMotion ? undefined : 'exit'}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                <legend className="px-1 text-base leading-7 font-semibold">
                  {currentStep + 1}. {currentQuestion.prompt}
                </legend>
                <div className="mt-4 grid gap-2.5">
                  {currentQuestion.options.map((option) => {
                    const selected =
                      answers[currentQuestion.questionId] === option.id;
                    return (
                      <label
                        key={option.id}
                        className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors ${
                          selected
                            ? 'border-accent bg-accent-soft text-ink'
                            : 'border-line bg-canvas hover:bg-surface'
                        }`}
                      >
                        <input
                          type="radio"
                          name={currentQuestion.questionId}
                          value={option.id}
                          checked={selected}
                          onChange={() =>
                            select(currentQuestion.questionId, option.id)
                          }
                          className="sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className={`grid size-5 shrink-0 place-items-center rounded-full border ${
                            selected
                              ? 'border-accent text-accent-strong'
                              : 'border-line'
                          }`}
                        >
                          {selected ? (
                            <CheckCircle size={17} weight="fill" />
                          ) : null}
                        </span>
                        {option.text}
                      </label>
                    );
                  })}
                </div>
              </motion.fieldset>
            </AnimatePresence>
          </div>

          {error ? (
            <p role="alert" className="mt-4 text-sm text-cinnabar">
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              disabled={currentStep === 0 || isPending}
              className="inline-flex min-h-12 items-center gap-2 rounded-full border border-line bg-card px-5 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowLeft aria-hidden="true" size={17} />
              上一题
            </button>

            {currentStep < total - 1 ? (
              <button
                type="button"
                onClick={goNext}
                disabled={!currentAnswered}
                className="inline-flex min-h-12 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-canvas transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                下一题
                <ArrowRight aria-hidden="true" size={18} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={isPending || !allAnswered}
                className="inline-flex min-h-12 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-canvas transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? '正在生成学习起点…' : '提交并进入学习'}
                {!isPending ? (
                  <ArrowRight aria-hidden="true" size={18} />
                ) : null}
              </button>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}
