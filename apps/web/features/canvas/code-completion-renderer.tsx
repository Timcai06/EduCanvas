'use client';

import type {
  CanvasFeedbackDTO,
  CanvasSubmissionDraft,
} from '@/features/learning/learning-contracts';
import type { PublicArtifact } from '@educanvas/canvas-protocol';
import { CheckCircle, Play, Terminal } from '@phosphor-icons/react';
import { useState } from 'react';
import { runCodeExercise } from './code-exercise-client';

type CodeCompletionArtifact = Extract<
  PublicArtifact,
  { type: 'code_completion' }
>;

export function CodeCompletionRenderer({
  artifact,
  disabled,
  feedback,
  onSubmit,
}: {
  artifact: CodeCompletionArtifact;
  disabled: boolean;
  feedback: CanvasFeedbackDTO | null;
  onSubmit: (draft: CanvasSubmissionDraft) => void;
}) {
  const [source, setSource] = useState(artifact.params.starterCode);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{
    stdout: string;
    stderr: string;
    succeeded: boolean;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const graded = feedback?.itemResults.find(
    (item) => item.itemId === 'solution',
  );

  const handleRun = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const result = await runCodeExercise({
        artifactId: artifact.artifactId,
        source,
      });
      setRunResult({
        stdout: result.stdout,
        stderr: result.stderr,
        succeeded: result.status === 'succeeded',
      });
    } catch {
      setRunError('运行环境暂时不可用，请稍后重试。');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="space-y-4" aria-label="Python 填空练习">
      <p className="leading-7 text-ink">{artifact.params.prompt}</p>
      <div className="overflow-hidden rounded-2xl border border-line bg-[#111827] shadow-sm">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs text-slate-300">
          <span>Python 3.11</span>
          <span>无网络 · 最长运行 3 秒</span>
        </div>
        <label className="sr-only" htmlFor={`code-${artifact.artifactId}`}>
          Python 代码
        </label>
        <textarea
          id={`code-${artifact.artifactId}`}
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setRunResult(null);
          }}
          disabled={disabled || running}
          spellCheck={false}
          className="min-h-64 w-full resize-y bg-transparent p-4 font-mono text-sm leading-6 text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={disabled || running || source.trim().length === 0}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 py-2 font-medium text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-surface-strong disabled:text-ink-faint"
        >
          <Play aria-hidden="true" weight="fill" />
          {running ? '正在运行…' : '运行代码'}
        </button>
        <button
          type="button"
          disabled={disabled || running || !runResult?.succeeded}
          onClick={() =>
            onSubmit({
              type: 'code_completion_submitted',
              artifactId: artifact.artifactId,
              payload: { source },
            })
          }
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-card px-4 py-2 font-medium text-ink transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-ink-faint"
        >
          <CheckCircle aria-hidden="true" />
          提交答案
        </button>
      </div>
      <div
        className="min-h-24 rounded-2xl border border-line bg-surface-strong p-4"
        aria-live="polite"
      >
        <p className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-ink">
          <Terminal aria-hidden="true" /> 运行结果
        </p>
        {runError ? <p className="text-sm text-bad">{runError}</p> : null}
        {runResult ? (
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm text-ink-muted">
            {runResult.stdout || runResult.stderr || '程序已运行，没有输出。'}
          </pre>
        ) : (
          <p className="text-sm text-ink-muted">
            填写关键代码后运行，这里会显示输出。
          </p>
        )}
      </div>
      {graded ? (
        <p className={graded.isCorrect ? 'text-good' : 'text-ink-muted'}>
          {graded.isCorrect
            ? '关键代码正确。'
            : '关键行还不正确，请根据运行结果继续调试。'}
        </p>
      ) : null}
    </section>
  );
}
