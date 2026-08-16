'use client';

import type { CSSProperties, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import type { ChatMessage } from './messages';
import './chat-minimap.css';

const MIN_SECTIONS = 4;
const MIN_OVERFLOW_PX = 96;
const READING_LINE_RATIO = 0.35;
const VISIBLE_SECTION_COUNT = 6;
const PREVIEW_LENGTH = 82;

export interface ChatMinimapSection {
  id: string;
  messageId: string;
  preview: string;
}

export interface ChatMinimapSectionMetric extends ChatMinimapSection {
  startY: number;
  endY: number;
}

interface MarkerLayout extends ChatMinimapSection {
  position: number;
  active: boolean;
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

/** 每个用户问题定义一个章节；原文只在单节点 hover/focus 预览中出现。 */
export function buildChatMinimapSections(
  messages: readonly ChatMessage[],
): readonly ChatMinimapSection[] {
  const studentMessages = messages.filter(
    (message) => message.role === 'student',
  );
  const source = studentMessages.length > 0 ? studentMessages : messages;
  return source
    .map((message) => {
      const normalized = message.text.replace(/\s+/g, ' ').trim();
      const preview = normalized
        ? normalized.length > PREVIEW_LENGTH
          ? `${normalized.slice(0, PREVIEW_LENGTH)}…`
          : normalized
        : '包含附件的提问';
      return {
        id: message.turnId,
        messageId: message.id,
        preview,
      };
    })
    .filter(
      (section, index, items) =>
        items.findIndex((item) => item.id === section.id) === index,
    );
}

export function resolveChatMinimapLayout({
  sections,
  scrollTop,
  scrollHeight,
  clientHeight,
}: {
  sections: readonly ChatMinimapSectionMetric[];
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): MinimapLayout {
  const safeScrollHeight = Math.max(scrollHeight, 1);
  const safeClientHeight = Math.max(clientHeight, 1);
  const readingY = scrollTop + safeClientHeight * READING_LINE_RATIO;
  const viewportBottom = scrollTop + safeClientHeight;
  const maxScrollTop = Math.max(0, safeScrollHeight - safeClientHeight);
  const atTop = scrollTop <= 1;
  const atBottom = scrollTop >= maxScrollTop - 1;

  return {
    shown:
      sections.length >= MIN_SECTIONS &&
      safeScrollHeight - safeClientHeight >= MIN_OVERFLOW_PX,
    viewportTop: clamp(scrollTop / safeScrollHeight, 0, 1),
    viewportHeight: clamp(safeClientHeight / safeScrollHeight, 0, 1),
    markers: sections.map((section, index) => ({
      id: section.id,
      messageId: section.messageId,
      preview: section.preview,
      position: clamp(section.startY / safeScrollHeight, 0, 1),
      active: atTop
        ? index === 0
        : atBottom
          ? index === sections.length - 1
          : readingY >= section.startY && readingY < section.endY,
      visible: section.endY > scrollTop && section.startY < viewportBottom,
    })),
  };
}

function findMessageAnchor(
  container: HTMLElement,
  messageId: string,
): HTMLElement | undefined {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-chat-message-id]'),
  ).find((element) => element.dataset.chatMessageId === messageId);
}

function contentTop(container: HTMLElement, element: HTMLElement): number {
  return (
    element.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop
  );
}

/**
 * 长对话的抽象空间导航。常态只显示提问节点；章节、视区和点击目标全部使用同一个
 * 滚动内容坐标系，流式消息改变高度后由 ResizeObserver 重新计算边界。
 */
export function ChatMinimap({
  messages,
  scrollRef,
}: {
  messages: readonly ChatMessage[];
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const [layout, setLayout] = useState<MinimapLayout>(EMPTY_LAYOUT);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  const sections = useMemo(
    () => buildChatMinimapSections(messages),
    [messages],
  );

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const measured = sections.flatMap((section) => {
        const anchor = findMessageAnchor(container, section.messageId);
        if (!anchor) return [];
        return [{ ...section, startY: contentTop(container, anchor) }];
      });
      const metrics = measured.map((section, index) => ({
        ...section,
        endY: measured[index + 1]?.startY ?? container.scrollHeight,
      }));
      setLayout(
        resolveChatMinimapLayout({
          sections: metrics,
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight,
        }),
      );
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
    scheduleMeasure();

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
      const targetTop = clamp(
        contentTop(container, anchor) -
          container.clientHeight * READING_LINE_RATIO,
        0,
        Math.max(0, container.scrollHeight - container.clientHeight),
      );
      container.scrollTo({
        top: targetTop,
        behavior: reducedMotion ? 'auto' : 'smooth',
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

  const activeIndex = Math.max(
    0,
    layout.markers.findIndex((marker) => marker.active),
  );
  const windowStart = clamp(
    activeIndex - Math.floor(VISIBLE_SECTION_COUNT / 2),
    0,
    Math.max(0, layout.markers.length - VISIBLE_SECTION_COUNT),
  );
  const visibleMarkers = layout.markers.slice(
    windowStart,
    windowStart + VISIBLE_SECTION_COUNT,
  );
  const localActiveIndex = visibleMarkers.findIndex((marker) => marker.active);
  const previewSection = sections.find((section) => section.id === previewId);

  const jumpBy = (step: number) => {
    const target = layout.markers[activeIndex + step];
    if (target) jumpToMessage(target.messageId);
  };

  return (
    <nav className="chat-minimap" aria-label="对话导航">
      <button
        type="button"
        className="chat-minimap__step"
        aria-label="上一段对话"
        disabled={activeIndex <= 0}
        onClick={() => jumpBy(-1)}
      >
        <CaretUp aria-hidden="true" size={13} weight="bold" />
      </button>
      <div
        className="chat-minimap__rail"
        style={
          {
            '--chat-minimap-active-index': Math.max(0, localActiveIndex),
            '--chat-minimap-section-count': visibleMarkers.length,
          } as CSSProperties
        }
      >
        <span
          className="chat-minimap__viewport"
          data-visible={localActiveIndex >= 0}
          aria-hidden="true"
        />
        {visibleMarkers.map((marker) => {
          const globalIndex = layout.markers.findIndex(
            (candidate) => candidate.id === marker.id,
          );
          return (
            <button
              key={marker.id}
              type="button"
              className="chat-minimap__marker"
              data-active={marker.active}
              data-visible={marker.visible}
              aria-label={`跳到第 ${globalIndex + 1} 段对话`}
              aria-current={marker.active ? 'location' : undefined}
              onClick={() => jumpToMessage(marker.messageId)}
              onPointerEnter={() => setPreviewId(marker.id)}
              onPointerLeave={() => setPreviewId(null)}
              onFocus={() => setPreviewId(marker.id)}
              onBlur={() => setPreviewId(null)}
            >
              <span aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="chat-minimap__step"
        aria-label="下一段对话"
        disabled={activeIndex >= layout.markers.length - 1}
        onClick={() => jumpBy(1)}
      >
        <CaretDown aria-hidden="true" size={13} weight="bold" />
      </button>
      <div
        className="chat-minimap__preview"
        data-visible={Boolean(previewSection)}
        aria-hidden={!previewSection}
      >
        <span>你</span>
        <p>{previewSection?.preview}</p>
      </div>
    </nav>
  );
}
