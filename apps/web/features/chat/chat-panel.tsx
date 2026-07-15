'use client';

import type { ChatMessage } from './demo-teacher-script';

/**
 * 消息流是纯展示组件：所有可变状态（消息、Canvas开合、判分）由 LearnWorkspace 持有。
 * 老师消息不使用气泡而直接落在页面上，学生消息是页面里唯一的气泡——视觉权重
 * 本身在表达「这是老师的课堂」；设计依据见 docs/01-product/student-ui-spec.md。
 */
export function ChatPanel({
  messages,
  isTyping,
  canvasOpen,
  artifactTitle,
  onOpenCanvas,
  onContinueText,
}: {
  messages: readonly ChatMessage[];
  isTyping: boolean;
  canvasOpen: boolean;
  artifactTitle: string;
  onOpenCanvas: () => void;
  onContinueText: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-4">
      {messages.map((message) =>
        message.role === 'student' ? (
          <div
            key={message.id}
            className="max-w-[80%] self-end rounded-[1.25rem] rounded-br-md bg-surface px-4 py-2.5 text-ink"
          >
            {message.text}
          </div>
        ) : (
          <div key={message.id} className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-strong text-xs font-semibold text-white"
            >
              ✦
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="leading-7 text-ink">{message.text}</p>
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
                    ◫
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {artifactTitle}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      互动分类 · 已生成
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-accent">
                    打开 ›
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        ),
      )}
      {isTyping ? (
        <div
          className="flex items-center gap-3"
          role="status"
          aria-label="老师正在输入"
        >
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-strong text-xs text-white"
          >
            ✦
          </span>
          <span className="flex gap-1" aria-hidden="true">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="size-2 rounded-full bg-ink-faint [animation:typing-dot_1.2s_ease-in-out_infinite] motion-reduce:animate-none"
                style={{ animationDelay: `${dot * 0.18}s` }}
              />
            ))}
          </span>
        </div>
      ) : null}
    </div>
  );
}
