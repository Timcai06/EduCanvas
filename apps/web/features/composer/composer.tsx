'use client';

import { useRef } from 'react';
import { PlusMenu, type PlusMenuActionId } from './plus-menu';

export interface ContextChip {
  id: string;
  label: string;
}

/**
 * 输入栏是页面最重要的操作入口：多行输入、「+」菜单、上下文标签、发送/生成状态。
 * 它不持有对话状态；文本提交、菜单动作全部上抛给 LearnWorkspace。
 * Enter 发送、Shift+Enter 换行（触屏窄屏由发送按钮承担发送）。
 */
export function Composer({
  chips,
  busy,
  statusText,
  onSend,
  onRemoveChip,
  onMenuAction,
}: {
  chips: readonly ContextChip[];
  /** 老师回复或判分进行中：发送键停用，状态行出现。 */
  busy: boolean;
  statusText: string | null;
  onSend: (text: string) => void;
  onRemoveChip: (id: string) => void;
  onMenuAction: (action: PlusMenuActionId) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text || busy) return;
    textarea.value = '';
    textarea.style.height = 'auto';
    onSend(text);
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-3">
      {chips.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span
              key={chip.id}
              className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink-muted"
            >
              {chip.label}
              <button
                type="button"
                aria-label={`移除资料 ${chip.label}`}
                onClick={() => onRemoveChip(chip.id)}
                className="ml-1 rounded-full px-1 text-ink-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-1 rounded-[var(--radius-pill)] bg-surface p-2 transition-shadow focus-within:shadow-[var(--shadow-float)] focus-within:ring-1 focus-within:ring-accent/30">
        <PlusMenu onAction={onMenuAction} />
        <textarea
          ref={textareaRef}
          rows={1}
          aria-label="向 AI 老师提问"
          placeholder="问问老师，或说说你的想法…"
          onInput={(event) => {
            const textarea = event.currentTarget;
            textarea.style.height = 'auto';
            /* 上限约 6 行，超出转为内部滚动，避免输入栏吞掉消息流 */
            textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit();
            }
          }}
          className="max-h-36 min-h-10 flex-1 resize-none self-center bg-transparent px-2 py-2 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          type="button"
          disabled
          title="语音输入即将开放"
          aria-label="语音输入（即将开放）"
          className="grid size-10 shrink-0 place-items-center rounded-full text-ink-faint"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-5 fill-current"
          >
            <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V20h2v-2.07A7 7 0 0 0 19 11h-2Z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          aria-label="发送"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:bg-surface-strong disabled:text-ink-faint"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-5 fill-current"
          >
            <path d="M3.4 20.4 21 12 3.4 3.6 3.39 10l12.61 2-12.61 2z" />
          </svg>
        </button>
      </div>
      <p
        className="mt-2 min-h-4 text-center text-xs text-ink-faint"
        aria-live="polite"
      >
        {statusText ?? 'AI 老师也可能出错，重要内容记得和课本核对。'}
      </p>
    </div>
  );
}
