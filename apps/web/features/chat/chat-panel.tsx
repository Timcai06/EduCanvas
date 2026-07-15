'use client';

import { ArrowRight, PresentationChart, Sparkle } from '@phosphor-icons/react';
import type { ChatMessage } from './messages';

/**
 * 消息流是纯展示组件：所有可变状态（消息、Canvas开合、判分）由 LearnWorkspace 持有。
 * 老师消息不使用气泡而直接落在页面上，学生消息是页面里唯一的气泡——视觉权重
 * 本身在表达「这是老师的课堂」；设计依据见 docs/01-product/student-ui-spec.md。
 */
export function ChatPanel({
  messages,
  canvasOpen,
  artifactTitle,
  onOpenCanvas,
  onContinueText,
  onRetry,
}: {
  messages: readonly ChatMessage[];
  canvasOpen: boolean;
  artifactTitle: string;
  onOpenCanvas: () => void;
  onContinueText: () => void;
  onRetry: (assistantMessageId: string) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-4">
      {messages.map((message) => {
        if (message.role === 'student') {
          return (
          <div
            key={message.id}
            className="max-w-[80%] self-end rounded-[1.25rem] rounded-br-md bg-surface px-4 py-2.5 text-ink"
          >
            {message.text}
          </div>
          );
        }

        const isPersistedSafetyResponse =
          message.text.length > 0 &&
          message.failureCode?.startsWith('k12_') === true;
        return (
          <div key={message.id} className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-accent text-white"
            >
              <Sparkle size={15} weight="fill" />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              {message.status === 'pending' ? (
                <p className="leading-7 text-ink-muted">正在连接 AI 老师…</p>
              ) : null}
              {message.text ? (
                <p className="whitespace-pre-wrap leading-7 text-ink">
                  {message.text}
                </p>
              ) : null}
              {!isPersistedSafetyResponse &&
              (message.status === 'failed' ||
                message.status === 'interrupted' ||
                message.status === 'cancelled') ? (
                <div className="space-y-2">
                  <p className="text-sm leading-6 text-ink-muted">
                    {message.status === 'cancelled'
                      ? '你已停止这次回答。'
                      : message.failureMessage ??
                        (message.status === 'interrupted'
                          ? '回答意外中断了，你可以重新发送这条问题。'
                          : 'AI 老师暂时无法连接，请稍后重试。')}
                  </p>
                  {(message.retryable || message.status === 'cancelled') &&
                  message.retryText ? (
                    <button
                      type="button"
                      onClick={() => onRetry(message.id)}
                      className="min-h-10 rounded-full border border-line bg-canvas px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                    >
                      重新发送
                    </button>
                  ) : null}
                </div>
              ) : null}
              {message.cite ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink-muted">
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-sm bg-ink-faint"
                  />
                  {message.cite}
                </span>
              ) : null}
              {message.suggestsCanvas && !canvasOpen ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onOpenCanvas}
                    className="min-h-10 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  >
                    打开互动演示
                  </button>
                  <button
                    type="button"
                    onClick={onContinueText}
                    className="min-h-10 rounded-full border border-line bg-canvas px-5 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  >
                    继续文字讲解
                  </button>
                </div>
              ) : null}
              {message.outputCard ? (
                <button
                  type="button"
                  onClick={onOpenCanvas}
                  className="flex w-full max-w-sm items-center gap-3 rounded-2xl border border-line bg-canvas p-3 text-left shadow-[var(--shadow-float)] transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft font-semibold text-accent"
                  >
                    <PresentationChart size={21} weight="regular" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {artifactTitle}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      互动分类 · 本课预置
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-accent">
                    <span className="inline-flex items-center gap-1">
                      打开
                      <ArrowRight aria-hidden="true" size={14} weight="bold" />
                    </span>
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
