'use client';

import { submitDiagnosticAction } from '@/app/learn/actions';
import type {
  StudyActionResultDTO,
  StudyDiagnosticDTO,
} from '@/features/learning/learning-contracts';
import { ArrowRight, CheckCircle } from '@phosphor-icons/react';
import { useMemo, useState, useTransition } from 'react';
import { TopBar } from '../workspace/learning/top-bar';

/** 短诊断只保存选择；浏览器既看不到正确答案，也不能提交自报分数。 */
export function StudyDiagnostic({ data }: { data: StudyDiagnosticDTO }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const answeredCount = useMemo(
    () =>
      data.diagnostic.questions.filter(
        (question) => answers[question.questionId],
      ).length,
    [answers, data.diagnostic.questions],
  );

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result: StudyActionResultDTO = await submitDiagnosticAction({
        attemptId: crypto.randomUUID(),
        answers: data.diagnostic.questions.map((question) => ({
          questionId: question.questionId,
          selectedOptionId: answers[question.questionId] ?? '',
        })),
      });
      setError(result.message);
    });
  };

  return (
    <main className="min-h-dvh bg-canvas text-ink">
      <TopBar
        courseTitle={data.topic}
        stageLabel="短诊断"
        masteryPercent={null}
      />
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-12">
        <div className="mb-8">
          <p className="text-sm font-semibold text-accent-strong">
            {answeredCount}/{data.diagnostic.questions.length} 已完成
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">
            找到最适合你的起点
          </h1>
          <p className="mt-3 leading-7 text-ink-muted">
            目标：{data.desiredOutcome}
            。不知道也没关系，结果只用于区分优势、重点和待学习内容。
          </p>
        </div>

        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {data.diagnostic.questions.map((question, questionIndex) => (
            <fieldset
              key={question.questionId}
              className="rounded-3xl border border-line bg-surface p-5 sm:p-6"
            >
              <legend className="px-1 text-base leading-7 font-semibold">
                {questionIndex + 1}. {question.prompt}
              </legend>
              <div className="mt-4 grid gap-2.5">
                {question.options.map((option) => {
                  const selected = answers[question.questionId] === option.id;
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
                        name={question.questionId}
                        value={option.id}
                        checked={selected}
                        onChange={() =>
                          setAnswers((current) => ({
                            ...current,
                            [question.questionId]: option.id,
                          }))
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
            </fieldset>
          ))}

          {error ? (
            <p role="alert" className="text-sm text-cinnabar">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={
              isPending || answeredCount !== data.diagnostic.questions.length
            }
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? '正在生成学习起点…' : '提交并进入学习'}
            {!isPending ? <ArrowRight aria-hidden="true" size={18} /> : null}
          </button>
        </form>
      </div>
    </main>
  );
}
