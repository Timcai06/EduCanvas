'use client';

import { useGSAP } from '@gsap/react';
import {
  ArrowRight,
  FilePdf,
  Image as ImageIcon,
  PresentationChart,
  Sparkle,
} from '@phosphor-icons/react';
import gsap from 'gsap';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import type { HtmlPreviewRequest } from './markdown';
import { MessageMarkdown } from './markdown';
import type { ChatMessage } from './messages';
import { StreamShimmer } from './stream-shimmer';

gsap.registerPlugin(useGSAP);

/** 助手头像在等待/流式期间轻微呼吸,完成后回到静态;reduced-motion 不动。 */
function AssistantAvatar({ active }: { active: boolean }) {
  const rootRef = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        if (!active) {
          gsap.set(root, { scaleX: 1, scaleY: 1, rotate: 0 });
          return;
        }
        /* revertOnUpdate 会重置动画属性;GSAP 无法重置 scale 简写,必须用独立属性 */
        gsap.to(root, {
          scaleX: 1.12,
          scaleY: 1.12,
          rotate: 12,
          duration: 0.9,
          ease: 'sine.inOut',
          repeat: -1,
          yoyo: true,
        });
      });
      return () => media.revert();
    },
    { scope: rootRef, dependencies: [active], revertOnUpdate: true },
  );

  return (
    <span
      ref={rootRef}
      aria-hidden="true"
      className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-accent text-white"
    >
      <Sparkle size={15} weight="fill" />
    </span>
  );
}

function AnimatedMessage({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          root,
          { autoAlpha: 0, y: 8 },
          { autoAlpha: 1, y: 0, duration: 0.34, ease: 'power2.out' },
        );
      });
      media.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(root, { autoAlpha: 1, y: 0 });
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );
  return (
    <div ref={rootRef} className={className}>
      {children}
    </div>
  );
}

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
  onPreviewHtml,
  assistantLabel = 'AI 老师',
}: {
  messages: readonly ChatMessage[];
  canvasOpen: boolean;
  artifactTitle: string;
  onOpenCanvas: () => void;
  onContinueText: () => void;
  onRetry: (assistantMessageId: string) => void;
  /** 提供后,助手消息中的 ```html 代码块渲染为可点击的沙箱预览卡(ADR-0010 Tier 2)。 */
  onPreviewHtml?: (request: HtmlPreviewRequest) => void;
  assistantLabel?: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-4">
      {messages.map((message) => {
        if (message.role === 'student') {
          return (
            <AnimatedMessage
              key={message.id}
              className="max-w-[80%] self-end rounded-[1.25rem] rounded-br-md border border-white/[0.035] bg-surface px-4 py-2.5 text-ink shadow-[0_8px_30px_rgb(0_0_0_/_0.12)]"
            >
              {message.text ? <p>{message.text}</p> : null}
              {message.attachments.length > 0 ? (
                <div
                  className={`flex flex-wrap gap-2 ${message.text ? 'mt-2' : ''}`}
                >
                  {message.attachments.map((attachment) => (
                    <span
                      key={attachment.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas/60 px-2.5 py-1 text-xs text-ink-muted"
                    >
                      {attachment.kind === 'image' ? (
                        <ImageIcon size={13} />
                      ) : (
                        <FilePdf size={13} />
                      )}
                      {attachment.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </AnimatedMessage>
          );
        }

        const isPersistedSafetyResponse =
          message.text.length > 0 &&
          message.failureCode?.startsWith('k12_') === true;
        return (
          <AnimatedMessage key={message.id} className="flex gap-3">
            <AssistantAvatar
              active={
                message.status === 'pending' || message.status === 'streaming'
              }
            />
            <div className="min-w-0 flex-1 space-y-2">
              {message.status === 'pending' && !message.text ? (
                <>
                  <StreamShimmer />
                  <p className="sr-only">正在连接{assistantLabel}…</p>
                </>
              ) : null}
              {message.text ? (
                <MessageMarkdown
                  text={message.text}
                  onPreviewHtml={onPreviewHtml}
                  citationMarkers={message.citations
                    ?.map((citation) => citation.marker)
                    .filter((marker): marker is number => marker !== undefined)}
                  citationAnchorPrefix={message.id}
                />
              ) : null}
              {!isPersistedSafetyResponse &&
              (message.status === 'failed' ||
                message.status === 'interrupted' ||
                message.status === 'cancelled') ? (
                <div className="space-y-2">
                  <p className="text-sm leading-6 text-ink-muted">
                    {message.status === 'cancelled'
                      ? '你已停止这次回答。'
                      : (message.failureMessage ??
                        (message.status === 'interrupted'
                          ? '回答意外中断了，你可以重新发送这条问题。'
                          : `${assistantLabel}暂时无法连接，请稍后重试。`))}
                  </p>
                  {(message.retryable || message.status === 'cancelled') &&
                  (message.retryText ||
                    message.retryParts?.some(
                      (part) => part.type === 'asset_ref',
                    )) ? (
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
              {message.citations && message.citations.length > 0 ? (
                <div
                  className="flex flex-wrap gap-2 pt-1"
                  aria-label="回答引用"
                >
                  {message.citations.map((citation) => (
                    <span
                      key={citation.id}
                      {...(citation.marker !== undefined
                        ? { id: `cite-${message.id}-${citation.marker}` }
                        : {})}
                      title="来自本轮冻结的课程资料版本"
                      className="inline-flex scroll-mt-24 items-center gap-1.5 rounded-full border border-line/80 bg-surface/75 px-3 py-1 text-xs font-medium text-ink-muted"
                    >
                      {citation.marker !== undefined ? (
                        <span className="font-semibold text-accent">
                          {citation.marker}
                        </span>
                      ) : (
                        <span
                          aria-hidden="true"
                          className="size-1.5 rounded-full bg-accent"
                        />
                      )}
                      {citation.label}
                    </span>
                  ))}
                </div>
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
          </AnimatedMessage>
        );
      })}
    </div>
  );
}
