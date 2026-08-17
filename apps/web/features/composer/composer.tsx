'use client';

import {
  ArrowUp,
  Microphone,
  SidebarSimple,
  StopCircle,
  X,
} from '@phosphor-icons/react';
import { useRef, useSyncExternalStore, type ReactNode } from 'react';
import { PlusMenu, type PlusMenuActionId } from './plus-menu';
import { DeepResearchLauncher } from './deep-research-launcher';
import type { OutputPreference } from '@educanvas/agent-core';

const subscribeToHydration = () => () => undefined;
const getHydratedSnapshot = () => true;
const getServerSnapshot = () => false;

export interface ContextChip {
  id: string;
  label: string;
}

export interface ComposerToolChip {
  id: 'canvas';
  label: string;
  selected: boolean;
  detail?: string;
}

export interface ComposerVoiceControl {
  enabled: boolean;
  status:
    | 'idle'
    | 'starting'
    | 'authorizing'
    | 'recording'
    | 'finalizing'
    | 'stopped'
    | 'cancelled'
    | 'failed';
  reason: string | null;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}

export { normalizeDeepResearchTopic } from './deep-research-launcher';

/**
 * 输入栏是页面最重要的操作入口：多行输入、「+」菜单、上下文标签、发送/生成状态。
 * 视觉上它是桌面上「刚铺开的一页纸」（card 层），墨紫描边为主，
 * 边缘另有一条墨紫光弧沿框流动、聚焦时提亮加速（.ink-flow-line，纯装饰、不承载状态）。
 * 它不持有对话状态；文本提交、菜单动作全部上抛。
 * Enter 发送、Shift+Enter 换行（触屏窄屏由发送按钮承担发送）。
 */
export function Composer({
  chips,
  busy,
  statusText,
  value,
  onValueChange,
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
  voice,
  voiceAccessory,
  outputPreference,
  onOutputPreferenceChange,
  onDeepResearch,
}: {
  chips: readonly ContextChip[];
  /** 老师回复或判分进行中：发送键停用，状态行出现。 */
  busy: boolean;
  statusText: string | null;
  /** 受控草稿；语音转写与键盘输入共享同一份可编辑文本。 */
  value: string;
  onValueChange: (value: string) => void;
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
  voice?: ComposerVoiceControl;
  /** Dictation 旁的同尺寸语音能力入口；Composer 不反向依赖具体 Voice 产品。 */
  voiceAccessory?: ReactNode;
  /** 本轮输出形态偏好；仅影响呈现，不授予工具或 Runtime 权限。 */
  outputPreference?: OutputPreference;
  onOutputPreferenceChange?: (preference: OutputPreference) => void;
  /** 打开独立研究主题入口；研究仍通过同一 Turn API/Agent Loop 提交。 */
  onDeepResearch?: (topic: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getServerSnapshot,
  );
  const isLanding = variant === 'landing';
  const hasText = value.trim().length > 0;
  const hasPayload = hasText || chips.length > 0;
  const voiceActive =
    voice?.status === 'starting' ||
    voice?.status === 'authorizing' ||
    voice?.status === 'recording' ||
    voice?.status === 'finalizing';

  const submit = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const text = value.trim();
    if (!hasPayload || busy) return;
    onValueChange('');
    textarea.style.height = 'auto';
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
              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted"
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
        className={`ink-flow-shell relative flex items-end gap-1 border border-line bg-card p-2 transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[var(--shadow-float)] ${
          isLanding
            ? 'min-h-16 rounded-[1.75rem] shadow-[var(--shadow-float)]'
            : 'rounded-[1.375rem] shadow-[0_1px_2px_rgb(72_60_34_/_0.05)]'
        }`}
      >
        {/* 边框流动线：一条墨紫光弧绕框匀速流动，平时安静、聚焦提亮加速（纯 CSS，见 effects.css .ink-flow-line） */}
        <span aria-hidden="true" className="ink-flow-line" />
        <PlusMenu
          onAction={onMenuAction}
          availableActions={availableMenuActions}
          placement={isLanding ? 'below' : 'above'}
        />
        <textarea
          ref={textareaRef}
          value={value}
          /* SSR 已经会显示输入框；在 React 接管事件前保持 disabled，避免首次
             Enter 被原生 textarea 消费却没有触发提交。 */
          disabled={busy || !hydrated}
          rows={1}
          aria-label="向 EduCanvas 提问"
          placeholder={isLanding ? '向 EduCanvas 提问' : '继续对话…'}
          onChange={(event) => onValueChange(event.currentTarget.value)}
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
          className={`max-h-36 min-h-10 flex-1 resize-none self-center bg-transparent px-2 py-2 leading-6 text-ink outline-none placeholder:text-ink-muted ${
            isLanding ? 'text-base' : 'text-[15px]'
          }`}
        />
        {voice ? (
          <button
            type="button"
            disabled={busy || !voice.enabled || voice.status === 'finalizing'}
            onClick={voiceActive ? voice.onStop : voice.onStart}
            title={
              voiceActive ? '结束语音输入' : (voice.reason ?? '语音转文字')
            }
            aria-label={voiceActive ? '结束语音输入' : '语音转文字'}
            className={`grid size-10 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:text-ink-faint ${
              voiceActive
                ? 'bg-accent text-card'
                : 'text-ink-muted hover:bg-surface'
            }`}
          >
            {voiceActive ? (
              <StopCircle size={21} weight="fill" />
            ) : (
              <Microphone size={20} />
            )}
          </button>
        ) : null}
        {voiceAccessory}
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
            className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:bg-surface-strong disabled:text-ink-faint"
          >
            <ArrowUp aria-hidden="true" size={20} weight="bold" />
          </button>
        ) : !voice ? (
          <button
            type="button"
            disabled
            title="语音输入即将开放"
            aria-label="语音输入（即将开放）"
            className="grid size-10 shrink-0 place-items-center rounded-full text-ink-muted"
          >
            <Microphone aria-hidden="true" size={20} weight="regular" />
          </button>
        ) : null}
      </div>
      {voice?.reason ? (
        <div
          className="mt-2 rounded-xl border border-line/70 bg-surface/70 px-3 py-2 text-sm"
          aria-live="polite"
        >
          <p className="text-ink-muted">{voice.reason}</p>
        </div>
      ) : null}
      {toolChips.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
          {toolChips.map((tool) => {
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
                    : 'border-line bg-surface/75 text-ink-muted hover:bg-surface hover:text-ink'
                }`}
              >
                <SidebarSimple
                  aria-hidden="true"
                  size={15}
                  weight={tool.selected ? 'fill' : 'regular'}
                  className={tool.selected ? 'text-accent' : undefined}
                />
                <span>{tool.label}</span>
                {tool.detail ? (
                  <span className="text-[11px] text-ink-muted">
                    {tool.detail}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {onDeepResearch ? (
        <DeepResearchLauncher busy={busy} onSubmit={onDeepResearch} />
      ) : null}
      {onOutputPreferenceChange && outputPreference ? (
        <label className="mt-2 inline-flex items-center gap-2 px-1 text-xs text-ink-muted">
          <span>输出方式</span>
          <select
            aria-label="输出方式"
            value={outputPreference}
            onChange={(event) =>
              onOutputPreferenceChange(
                event.currentTarget.value as OutputPreference,
              )
            }
            className="rounded-full border border-line bg-surface/75 px-3 py-1.5 text-xs font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="auto">自动</option>
            <option value="markdown_document">Markdown 文档</option>
            <option value="interactive_artifact">互动 Canvas</option>
            <option value="web_app">Web App</option>
          </select>
        </label>
      ) : null}
      {!isLanding || statusText ? (
        <p
          className={`mt-2 min-h-4 text-center text-xs ${
            statusTone === 'error' ? 'text-bad' : 'text-ink-muted'
          }`}
        >
          {statusText ?? 'AI 也可能出错，请核对重要信息。'}
        </p>
      ) : null}
    </div>
  );
}
