'use client';

import {
  ArrowUp,
  BookOpen,
  Microphone,
  SidebarSimple,
  StopCircle,
  X,
} from '@phosphor-icons/react';
import { LogoMark } from '@/features/workspace/shared/logo-mark';
import { useRef, useState } from 'react';
import {
  COMPOSER_FOCUS_EVENT,
  COMPOSER_SEND_EVENT,
} from '@/features/workspace/shared/ambient-halo';
import { PlusMenu, type PlusMenuActionId } from './plus-menu';

/** 光场对输入行为的呼应是纯装饰,事件失败不影响输入,故直接触发不做防御。 */
const notifyHalo = (event: string, detail?: unknown) => {
  window.dispatchEvent(new CustomEvent(event, { detail }));
};

export interface ContextChip {
  id: string;
  label: string;
}

export interface ComposerToolChip {
  id: 'canvas' | 'sources';
  label: string;
  selected: boolean;
  detail?: string;
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
  availableMenuActions,
  toolChips = [],
  onToolAction,
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
  availableMenuActions?: readonly PlusMenuActionId[];
  toolChips?: readonly ComposerToolChip[];
  onToolAction?: (id: ComposerToolChip['id']) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const isLanding = variant === 'landing';
  const hasText = value.trim().length > 0;
  const hasPayload = hasText || chips.length > 0;

  const submit = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const text = value.trim();
    if (!hasPayload || busy) return;
    setValue('');
    textarea.style.height = 'auto';
    notifyHalo(COMPOSER_SEND_EVENT);
    onSend(text);
  };

  return (
    <div
      className={`mx-auto w-full px-4 ${
        isLanding ? 'max-w-[42rem]' : 'max-w-3xl pb-3'
      }`}
    >
      {chips.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span
              key={chip.id}
              className="inline-flex items-center gap-1 rounded-full border border-line/80 bg-surface/90 px-3 py-1 text-xs font-medium text-ink-muted shadow-[0_6px_20px_rgb(0_0_0_/_0.14)]"
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
        className={`flex items-end gap-1 border border-line/80 bg-surface/95 p-2 backdrop-blur-xl transition-[border-color,box-shadow,background-color] focus-within:border-accent/55 focus-within:bg-surface focus-within:shadow-[var(--shadow-float),0_0_0_1px_rgb(124_141_255_/_0.16)] ${
          isLanding
            ? 'min-h-16 rounded-[2rem] shadow-[0_14px_44px_rgb(0_0_0_/_0.28),inset_0_1px_0_rgb(255_255_255_/_0.035)]'
            : 'rounded-[var(--radius-pill)]'
        }`}
      >
        <PlusMenu
          onAction={onMenuAction}
          availableActions={availableMenuActions}
        />
        <textarea
          ref={textareaRef}
          value={value}
          disabled={busy}
          rows={1}
          aria-label="向 EduCanvas 提问"
          placeholder={isLanding ? '向 EduCanvas 提问' : '继续对话…'}
          onChange={(event) => setValue(event.currentTarget.value)}
          onFocus={() => notifyHalo(COMPOSER_FOCUS_EVENT, { focused: true })}
          onBlur={() => notifyHalo(COMPOSER_FOCUS_EVENT, { focused: false })}
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
            <LogoMark size={15} />
            EduCanvas
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
        ) : hasPayload ? (
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
      {toolChips.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
          {toolChips.map((tool) => {
            const Icon = tool.id === 'canvas' ? SidebarSimple : BookOpen;
            return (
              <button
                key={tool.id}
                type="button"
                aria-label={tool.label}
                aria-pressed={tool.selected}
                onClick={() => onToolAction?.(tool.id)}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
                  tool.selected
                    ? 'border-accent/55 bg-accent-soft text-ink'
                    : 'border-line/80 bg-surface/75 text-ink-muted hover:bg-surface hover:text-ink'
                }`}
              >
                <Icon aria-hidden="true" size={15} />
                <span>{tool.label}</span>
                {tool.detail ? (
                  <span className="text-[11px] text-ink-faint">
                    {tool.detail}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {!isLanding || statusText ? (
        <p
          className={`mt-2 min-h-4 text-center text-xs ${
            statusTone === 'error' ? 'text-bad' : 'text-ink-faint'
          }`}
        >
          {statusText ?? 'AI 也可能出错，请核对重要信息。'}
        </p>
      ) : null}
    </div>
  );
}
