'use client';

import type { LearningSessionSummaryDTO } from '@/features/learning/learning-contracts';
import {
  CaretRight,
  ChatCircleDots,
  MagnifyingGlass,
  Plus,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import {
  buildLearningSessionRailRows,
  getLearningRailCapabilities,
} from './learning-rail-model';
import { MarginaliaNav, type MarginaliaItem } from '../shared/marginalia-nav';
import { useLenis } from '../shared/use-lenis';
import { Sheet } from '@/components/sheet';

interface LearningRailProps {
  sessions: readonly LearningSessionSummaryDTO[];
  currentSessionId: string | null;
  mobileOpen: boolean;
  onMobileClose: () => void;
  onNewSession?: () => void;
  onResumeSession?: (sessionId: string) => void;
  searchEnabled?: boolean;
  onSearch?: (query: string) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

function SessionList({
  sessions,
  currentSessionId,
  onResumeSession,
}: Pick<
  LearningRailProps,
  'sessions' | 'currentSessionId' | 'onResumeSession'
>) {
  if (sessions.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-sm leading-6 text-ink-muted">
        还没有学习记录。开始对话后，课程会显示在这里。
      </p>
    );
  }

  const items: MarginaliaItem[] = buildLearningSessionRailRows(
    sessions,
    currentSessionId,
    Boolean(onResumeSession),
  ).map(({ session, resumable }) => ({
    id: session.id,
    title: session.title,
    subtitle: session.courseTitle,
    badge: session.hasInterruptedTurn ? '待重试' : undefined,
    selectable: resumable,
  }));

  return (
    <MarginaliaNav
      ariaLabel="学习记录"
      items={items}
      activeId={currentSessionId}
      onSelect={onResumeSession}
    />
  );
}

function RailContents(props: LearningRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 学习记录列表是非流式、非虚拟化的长列表 → 启用 lenis 平滑滚动；reduced-motion 关闭。
  useLenis(scrollRef);
  const capabilities = getLearningRailCapabilities({
    searchEnabled: props.searchEnabled === true,
    hasSearchCallback: Boolean(props.onSearch),
    hasMore: props.hasMore === true,
    hasLoadMoreCallback: Boolean(props.onLoadMore),
  });
  return (
    <div className="flex h-full flex-col">
      {props.onNewSession ? (
        <button
          type="button"
          onClick={props.onNewSession}
          className="shine-sweep group mb-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-card transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          <Plus
            aria-hidden="true"
            size={17}
            weight="bold"
            className="transition-transform group-hover:rotate-90"
          />
          开始新学习
        </button>
      ) : null}
      {capabilities.showSearch ? (
        <label className="ec-field mb-3 flex min-h-10 items-center gap-2 rounded-xl px-3 text-ink-muted">
          <MagnifyingGlass aria-hidden="true" size={17} />
          <span className="sr-only">搜索学习记录</span>
          <input
            type="search"
            placeholder="搜索学习记录"
            onChange={(event) => props.onSearch?.(event.currentTarget.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
          />
        </label>
      ) : null}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <SessionList
          sessions={props.sessions}
          currentSessionId={props.currentSessionId}
          onResumeSession={props.onResumeSession}
        />
      </div>
      {capabilities.showLoadMore && props.onLoadMore ? (
        <button
          type="button"
          onClick={props.onLoadMore}
          className="mt-3 min-h-10 rounded-full text-sm font-medium text-ink-muted hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          加载更多
        </button>
      ) : null}
    </div>
  );
}

/**
 * 桌面端保留一条常驻细栏（图标 + 记录数），点击不再原地撑开成挤占版面的
 * 内联面板——那会露出又粗又贴边的原生滚动条——而是和窄屏一样弹出 Sheet 抽屉，
 * 列表在抽屉内滚动、配细样式滚动条。窄屏开合仍由父组件的 mobileOpen 控制。
 */
export function LearningRail(props: LearningRailProps) {
  const [deskOpen, setDeskOpen] = useState(false);
  const open = deskOpen || props.mobileOpen;

  const close = () => {
    setDeskOpen(false);
    if (props.mobileOpen) props.onMobileClose();
  };

  return (
    <>
      <aside
        aria-label="学习记录侧栏"
        className="hidden min-h-0 w-16 shrink-0 flex-col items-center border-r border-line/70 px-2 lg:flex"
      >
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={deskOpen}
          aria-label="打开学习记录"
          onClick={() => setDeskOpen(true)}
          className="mb-3 grid size-11 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChatCircleDots aria-hidden="true" size={21} />
        </button>
        {props.sessions.length > 0 ? (
          <span
            className="mt-1 grid size-8 place-items-center rounded-full bg-surface text-xs font-semibold text-ink-muted"
            title={`${props.sessions.length} 条学习记录`}
            aria-label={`${props.sessions.length} 条学习记录`}
          >
            {Math.min(props.sessions.length, 99)}
          </span>
        ) : null}
        <CaretRight aria-hidden="true" className="mt-auto mb-2" size={14} />
      </aside>
      {open ? (
        <Sheet label="学习记录" eyebrow="Sessions" onClose={close}>
          <RailContents {...props} />
        </Sheet>
      ) : null}
    </>
  );
}
