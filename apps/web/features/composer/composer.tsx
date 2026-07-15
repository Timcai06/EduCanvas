'use client';

import {
  ArrowUp,
  Microphone,
  Sparkle,
  StopCircle,
  X,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';
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
  onStop,
  stopAvailable = false,
  variant = 'conversation',
  statusTone = 'info',
}: {
  chips: readonly ContextChip[];
  /** 老师回复或判分进行中：发送键停用，状态行出现。 */
  busy: boolean;
  statusText: string | null;
  onSend: (text: string) => void;
  onRemoveChip: (id: string) => void;
  onMenuAction: (action: PlusMenuActionId) => void;
  onStop?: () => void;
  stopAvailable?: boolean;
  variant?: 'landing' | 'conversation';
  statusTone?: 'info' | 'error';
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const isLanding = variant === 'landing';
  const hasText = value.trim().length > 0;

  const submit = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const text = value.trim();
    if (!text || busy) return;
    setValue('');
    textarea.style.height = 'auto';
    onSend(text);
  };

  return (
    <div
      className={`mx-auto w-full px-4 ${
        isLanding ? 'max-w-[46rem]' : 'max-w-3xl pb-3'
      }`}
    >
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
                className="ml-1 grid size-5 place-items-center rounded-full text-ink-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X aria-hidden="true" size={12} weight="bold" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div
        className={`flex items-end gap-1 border border-line bg-surface p-2 transition-[box-shadow,background-color] focus-within:bg-surface focus-within:shadow-[var(--shadow-float)] focus-within:ring-2 focus-within:ring-accent ${
          isLanding
            ? 'min-h-16 rounded-[2rem] shadow-[0_1px_2px_rgb(0_0_0_/_0.4)]'
            : 'rounded-[var(--radius-pill)]'
        }`}
      >
        <PlusMenu onAction={onMenuAction} />
        <textarea
          ref={textareaRef}
          value={value}
          disabled={busy}
          rows={1}
          aria-label="向 AI 老师提问"
          placeholder={isLanding ? '问问 AI 老师' : '继续和老师聊聊…'}
          onChange={(event) => setValue(event.currentTarget.value)}
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
          className={`max-h-36 min-h-10 flex-1 resize-none self-center bg-transparent px-2 py-2 leading-6 text-ink outline-none placeholder:text-ink-faint ${
            isLanding ? 'text-base' : 'text-[15px]'
          }`}
        />
        {isLanding ? (
          <span className="hidden shrink-0 items-center gap-1.5 px-2 text-sm font-medium text-ink-muted sm:inline-flex">
            <Sparkle aria-hidden="true" size={15} weight="fill" />
            AI 老师
          </span>
        ) : null}
        {busy && stopAvailable && onStop ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="停止回答"
            title="停止回答"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-canvas transition-colors hover:bg-ink/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            <StopCircle aria-hidden="true" size={21} weight="fill" />
          </button>
        ) : hasText ? (
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            aria-label="发送"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:bg-surface-strong disabled:text-ink-faint"
          >
            <ArrowUp aria-hidden="true" size={20} weight="bold" />
          </button>
        ) : (
          <button
            type="button"
            disabled
            title="语音输入即将开放"
            aria-label="语音输入（即将开放）"
            className="grid size-10 shrink-0 place-items-center rounded-full text-ink-muted"
          >
            <Microphone aria-hidden="true" size={20} weight="regular" />
          </button>
        )}
      </div>
      {!isLanding || statusText ? (
        <p
          className={`mt-2 min-h-4 text-center text-xs ${
            statusTone === 'error' ? 'text-bad' : 'text-ink-faint'
          }`}
        >
          {statusText ?? 'AI 老师也可能出错，重要内容记得和课本核对。'}
        </p>
      ) : null}
    </div>
  );
}
