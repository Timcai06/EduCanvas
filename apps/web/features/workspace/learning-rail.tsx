'use client';

import type { LearningSessionSummaryDTO } from '@/features/learning/learning-contracts';
import {
  CaretLeft,
  CaretRight,
  ChatCircleDots,
  MagnifyingGlass,
  Plus,
} from '@phosphor-icons/react';
import { useState } from 'react';
import {
  buildLearningSessionRailRows,
  getLearningRailCapabilities,
} from './learning-rail-model';
import { Sheet } from './sheet';

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

  return (
    <nav aria-label="学习记录" className="space-y-1">
      {buildLearningSessionRailRows(
        sessions,
        currentSessionId,
        Boolean(onResumeSession),
      ).map(({ session, current, resumable }) => {
        const content = (
          <>
            <span className="block truncate text-sm font-medium text-ink">
              {session.title}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
              <span className="truncate">{session.courseTitle}</span>
              {session.hasInterruptedTurn ? (
                <span className="shrink-0 text-warn">待重试</span>
              ) : null}
            </span>
          </>
        );
        const classes = `block w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
          current ? 'bg-accent-soft' : 'hover:bg-surface'
        }`;

        return resumable && onResumeSession ? (
          <button
            key={session.id}
            type="button"
            data-session-id={session.id}
            onClick={() => onResumeSession(session.id)}
            className={classes}
          >
            {content}
          </button>
        ) : (
          <div
            key={session.id}
            data-session-id={session.id}
            aria-current={current ? 'page' : undefined}
            className={classes}
          >
            {content}
          </div>
        );
      })}
    </nav>
  );
}

function RailContents(props: LearningRailProps) {
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
          className="mb-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus aria-hidden="true" size={17} weight="bold" />
          开始新学习
        </button>
      ) : null}
      {capabilities.showSearch ? (
        <label className="mb-3 flex min-h-10 items-center gap-2 rounded-xl border border-line px-3 text-ink-muted focus-within:ring-2 focus-within:ring-accent">
          <MagnifyingGlass aria-hidden="true" size={17} />
          <span className="sr-only">搜索学习记录</span>
          <input
            type="search"
            placeholder="搜索学习记录"
            onChange={(event) => props.onSearch?.(event.currentTarget.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
        </label>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
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

/** Desktop stays collapsed by default; mobile history is a modal Sheet. */
export function LearningRail(props: LearningRailProps) {
  const [expanded, setExpanded] = useState(false);

  const updateExpanded = (next: boolean) => {
    setExpanded(next);
  };

  return (
    <>
      <aside
        aria-label="学习记录侧栏"
        className={`hidden min-h-0 shrink-0 border-r border-line/70 transition-[width] duration-200 lg:flex lg:flex-col ${
          expanded ? 'w-72 px-3 pb-4' : 'w-16 items-center px-2'
        }`}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? '收起学习记录' : '展开学习记录'}
          onClick={() => updateExpanded(!expanded)}
          className="mb-3 grid size-10 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {expanded ? (
            <CaretLeft aria-hidden="true" size={19} />
          ) : (
            <ChatCircleDots aria-hidden="true" size={21} />
          )}
        </button>
        {expanded ? <RailContents {...props} /> : null}
        {!expanded && props.sessions.length > 0 ? (
          <span
            className="mt-1 grid size-8 place-items-center rounded-full bg-surface text-xs font-semibold text-ink-muted"
            title={`${props.sessions.length} 条学习记录`}
            aria-label={`${props.sessions.length} 条学习记录`}
          >
            {Math.min(props.sessions.length, 99)}
          </span>
        ) : null}
        {!expanded ? (
          <CaretRight aria-hidden="true" className="mt-auto mb-2" size={14} />
        ) : null}
      </aside>
      {props.mobileOpen ? (
        <Sheet label="学习记录" onClose={props.onMobileClose}>
          <RailContents {...props} />
        </Sheet>
      ) : null}
    </>
  );
}
