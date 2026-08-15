'use client';

import type { CSSProperties, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from './messages';
import './chat-minimap.css';

const MIN_SECTIONS = 4;
const MAX_SECTIONS = 10;
const MIN_OVERFLOW_PX = 96;
const MAX_LABEL_LENGTH = 42;

interface MarkerLayout {
  id: string;
  messageId: string;
  position: number;
  visible: boolean;
}

interface MinimapLayout {
  shown: boolean;
  viewportTop: number;
  viewportHeight: number;
  markers: readonly MarkerLayout[];
}

const EMPTY_LAYOUT: MinimapLayout = {
  shown: false,
  viewportTop: 0,
  viewportHeight: 1,
  markers: [],
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function chatMinimapMessageLabel(message: ChatMessage): string {
  const speaker = message.role === 'student' ? '你' : 'AI';
  const normalized = message.text.replace(/\s+/g, ' ').trim();
  const fallback =
    message.attachments.length > 0
      ? `包含 ${message.attachments.length} 个附件`
      : message.status === 'pending'
        ? '正在回答'
        : '空消息';
  const text = normalized || fallback;
  const clipped =
    text.length > MAX_LABEL_LENGTH
      ? `${text.slice(0, MAX_LABEL_LENGTH)}…`
      : text;
  return `${speaker} · ${clipped}`;
}

function findMessageAnchor(
  container: HTMLElement,
  messageId: string,
): HTMLElement | undefined {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-chat-message-id]'),
  ).find((element) => element.dataset.chatMessageId === messageId);
}

/**
 * 长对话的空间导航。每个用户问题是一段真实的 section label；一轮里的用户与 AI
 * 消息共同决定 active 状态，避免滚到回答中段时左侧锚点提前熄灭。
 */
export function ChatMinimap({
  messages,
  scrollRef,
}: {
  messages: readonly ChatMessage[];
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const [layout, setLayout] = useState<MinimapLayout>(EMPTY_LAYOUT);
  const focusTimerRef = useRef<number | null>(null);

  const sections = useMemo(() => {
    const studentMessages = messages.filter(
      (message) => message.role === 'student',
    );
    const source = studentMessages.length > 0 ? studentMessages : messages;
    const allSections = source
      .map((message) => ({
        id: message.turnId,
        messageId: message.id,
        label: chatMinimapMessageLabel(message),
      }))
      .filter(
        (section, index, items) =>
          items.findIndex((item) => item.id === section.id) === index,
      );
    if (allSections.length <= MAX_SECTIONS) return allSections;
    return Array.from({ length: MAX_SECTIONS }, (_, index) => {
      const sourceIndex = Math.round(
        (index * (allSections.length - 1)) / (MAX_SECTIONS - 1),
      );
      return allSections[sourceIndex]!;
    });
  }, [messages]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const scrollHeight = Math.max(container.scrollHeight, 1);
      const clientHeight = Math.max(container.clientHeight, 1);
      const containerRect = container.getBoundingClientRect();
      const messageAnchors = Array.from(
        container.querySelectorAll<HTMLElement>('[data-chat-message-id]'),
      );
      const visibleTop = containerRect.top + clientHeight * 0.08;
      const visibleBottom = containerRect.bottom - clientHeight * 0.08;

      setLayout({
        shown:
          sections.length >= MIN_SECTIONS &&
          scrollHeight - clientHeight >= MIN_OVERFLOW_PX,
        viewportTop: clamp(container.scrollTop / scrollHeight, 0, 1),
        viewportHeight: clamp(clientHeight / scrollHeight, 0, 1),
        markers: sections.flatMap((section, sectionIndex) => {
          const turnAnchors = messageAnchors.filter(
            (anchor) => anchor.dataset.chatTurnId === section.id,
          );
          const anchor = turnAnchors[0];
          if (!anchor) return [];
          const turnRects = turnAnchors.map((element) =>
            element.getBoundingClientRect(),
          );
          const turnTop = Math.min(...turnRects.map((rect) => rect.top));
          const turnBottom = Math.max(...turnRects.map((rect) => rect.bottom));
          return [
            {
              id: section.id,
              messageId: section.messageId,
              position:
                sections.length === 1
                  ? 0.5
                  : sectionIndex / (sections.length - 1),
              visible: turnBottom >= visibleTop && turnTop <= visibleBottom,
            },
          ];
        }),
      });
    };
    const scheduleMeasure = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(container);
    container
      .querySelectorAll<HTMLElement>('[data-chat-message-id]')
      .forEach((anchor) => resizeObserver.observe(anchor));
    container.addEventListener('scroll', scheduleMeasure, { passive: true });
    measure();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      container.removeEventListener('scroll', scheduleMeasure);
    };
  }, [messages, scrollRef, sections]);

  useEffect(
    () => () => {
      if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    },
    [],
  );

  const jumpToMessage = useCallback(
    (messageId: string) => {
      const container = scrollRef.current;
      if (!container) return;
      const anchor = findMessageAnchor(container, messageId);
      if (!anchor) return;

      const reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      anchor.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'center',
      });
      anchor.focus({ preventScroll: true });
      anchor.dataset.chatMinimapFocus = 'true';
      if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = window.setTimeout(() => {
        delete anchor.dataset.chatMinimapFocus;
        focusTimerRef.current = null;
      }, 900);
    },
    [scrollRef],
  );

  if (!layout.shown) return null;

  return (
    <nav className="chat-minimap" aria-label="对话导航">
      <div className="chat-minimap__rail">
        <span
          className="chat-minimap__viewport"
          style={
            {
              '--chat-minimap-viewport-top': layout.viewportTop,
              '--chat-minimap-viewport-height': layout.viewportHeight,
            } as CSSProperties
          }
          aria-hidden="true"
        />
        {layout.markers.map((marker) => {
          const section = sections.find((item) => item.id === marker.id);
          return (
            <button
              key={marker.id}
              type="button"
              className="chat-minimap__marker"
              data-active={marker.visible}
              style={
                {
                  '--chat-minimap-marker-position': marker.position,
                } as CSSProperties
              }
              aria-label={`跳到${section?.label ?? '消息'}`}
              aria-current={marker.visible ? 'location' : undefined}
              onClick={() => jumpToMessage(marker.messageId)}
            >
              <span className="chat-minimap__marker-line" aria-hidden="true" />
              <span className="chat-minimap__label">{section?.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
