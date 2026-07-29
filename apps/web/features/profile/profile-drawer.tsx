'use client';

import { ArrowRight, ArrowsClockwise, UserCircle } from '@phosphor-icons/react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { type LearningActivity } from '@/features/profile/activity-contract';
import { ConnectionSettings } from '@/features/settings/connection-settings';
import { ProfileSettings } from '@/features/settings/profile-settings';
import { ThemeToggle } from '@/features/theme/theme-toggle';
import { Sheet } from '@/features/workspace/shared/sheet';
import { AuroraInk } from './aurora-ink';
import { CountUp } from './count-up';
import {
  fetchLearningActivity,
  type ActivityLoadState,
} from './learning-activity-loader';

interface CurrentUser {
  nickname: string;
  username?: string;
  avatarAvailable: boolean;
}

/**
 * 档案抽屉：从头像打开的「快速一瞥」。只放身份与两个入口，深入信息（热力图、掌握度、
 * 未来的成就与目标）在 /profile 完整页。抽屉=一瞥，页面=深入。
 */
export function ProfileDrawer({
  conversationId,
  notebookTitle,
  initialUser = null,
  onUserChange,
  onClose,
}: {
  conversationId?: string;
  notebookTitle?: string | null;
  /** 头像入口已读取的用户投影，用于避免抽屉首帧从"游客"跳到真实昵称。 */
  initialUser?: CurrentUser | null;
  onUserChange?: (user: { nickname: string; avatarAvailable: boolean }) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(initialUser);
  // 活动状态由 P03 loader 驱动：loading / ready / empty / failed
  const [activityState, setActivityState] = useState<ActivityLoadState>({
    kind: 'loading',
  });
  const activityAbortRef = useRef<AbortController | null>(null);

  // ---- 用户信息加载 ----
  useEffect(() => {
    void fetch('/api/v1/me', { cache: 'no-store' })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { user: CurrentUser | null })
          : undefined,
      )
      .then((body) => {
        if (body !== undefined) setUser(body.user);
      })
      .catch(() => undefined);
  }, []);

  // ---- 学习活动加载（P03 loader） ----
  const loadActivity = () => {
    activityAbortRef.current?.abort();
    const controller = new AbortController();
    activityAbortRef.current = controller;
    // 重试必须立刻恢复 loading，避免失败提示在新请求期间继续显示。
    setActivityState({ kind: 'loading' });

    fetchLearningActivity(controller.signal).then((state) => {
      if (!controller.signal.aborted) {
        setActivityState(state);
      }
      if (activityAbortRef.current === controller) {
        activityAbortRef.current = null;
      }
    });
  };

  // 抽屉打开时发起请求——逻辑直接内联在 effect body 中，避免 setState-in-effect 警告
  useEffect(() => {
    activityAbortRef.current?.abort();
    const controller = new AbortController();
    activityAbortRef.current = controller;
    // 初始状态已是 loading，不需在此 setState

    fetchLearningActivity(controller.signal).then((state) => {
      if (!controller.signal.aborted) {
        setActivityState(state);
      }
      if (activityAbortRef.current === controller) {
        activityAbortRef.current = null;
      }
    });

    return () => {
      activityAbortRef.current?.abort();
      activityAbortRef.current = null;
    };
  }, []);

  const go = (path: string) => {
    router.push(path);
    onClose();
  };

  // 从 activityState 中提取展示值
  const activityValue = (): LearningActivity | null => {
    if (activityState.kind === 'ready') return activityState.activity;
    return null;
  };
  const isBusy = activityState.kind === 'loading';
  const isFailed = activityState.kind === 'failed';
  const isEmpty = activityState.kind === 'empty';

  return (
    <Sheet label="我的档案" eyebrow="Profile" stableHeight onClose={onClose}>
      <div className="flex flex-col gap-6">
        <div
          data-sheet-item
          className="relative overflow-hidden rounded-3xl border border-line/70 bg-surface/55 p-4 shadow-[var(--shadow-sm)]"
        >
          <AuroraInk />
          <div className="relative flex items-center gap-4">
            <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-accent-soft text-accent shadow-[var(--shadow-sm)]">
              {user?.avatarAvailable ? (
                <Image
                  src="/api/v1/me/avatar"
                  alt=""
                  width={64}
                  height={64}
                  unoptimized
                  className="size-full object-cover"
                />
              ) : (
                <UserCircle aria-hidden="true" size={36} />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-xl font-semibold tracking-[0.025em] text-ink">
                {user?.nickname ?? '游客'}
              </p>
              <p className="mt-0.5 truncate font-mono text-xs tracking-wide text-ink-muted">
                {user?.username
                  ? `@${user.username}`
                  : '未登录 · 记录只留在当前浏览器'}
              </p>
            </div>
          </div>
        </div>

        {/* 学习活动统计区 */}
        <div data-sheet-item>
          <div
            aria-busy={isBusy}
            className="grid min-h-[4.25rem] grid-cols-3 gap-2 rounded-2xl border border-line bg-surface/40 p-1"
          >
            <MiniStat
              value={activityValue()?.streakDays ?? null}
              unit="天"
              label="连续"
            />
            <MiniStat
              value={activityValue()?.activeDays ?? null}
              unit="天"
              label="活跃"
            />
            <MiniStat
              value={activityValue()?.masteryPercent ?? null}
              unit="%"
              label="掌握度"
            />
          </div>

          {/* 失败状态：重试按钮 */}
          {isFailed ? (
            <div
              role="alert"
              aria-live="polite"
              className="mt-2 flex items-center justify-between rounded-xl bg-warn/10 px-3 py-2 text-sm text-ink-muted"
            >
              <span>暂时无法加载学习活动</span>
              <button
                type="button"
                onClick={loadActivity}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent"
              >
                <ArrowsClockwise aria-hidden="true" size={14} />
                重试
              </button>
            </div>
          ) : null}

          {/* 空态：诚实展示 */}
          {isEmpty ? (
            <p
              className="mt-2 text-center text-xs text-ink-muted"
              aria-live="polite"
            >
              还没有学习记录
            </p>
          ) : null}
        </div>

        <button
          data-sheet-item
          type="button"
          onClick={() => go('/profile')}
          className="shine-sweep group inline-flex min-h-12 items-center justify-between rounded-full bg-accent px-6 text-sm font-semibold text-card shadow-[0_10px_28px_-8px_color-mix(in_srgb,var(--color-accent)_65%,transparent)] transition-transform hover:-translate-y-0.5"
        >
          <span>查看完整档案</span>
          <ArrowRight
            aria-hidden="true"
            size={17}
            weight="bold"
            className="transition-transform group-hover:translate-x-1"
          />
        </button>

        <section
          data-sheet-item
          className="border-t border-line/60 pt-6"
          aria-labelledby="profile-appearance-heading"
        >
          <h3
            id="profile-appearance-heading"
            className="font-display text-lg font-semibold text-ink"
          >
            外观
          </h3>
          <p className="mb-4 mt-1 text-sm leading-6 text-ink-muted">
            主题偏好跟随你的账号入口，不再另设设置页面。
          </p>
          <ThemeToggle />
        </section>

        <details data-sheet-item className="group border-t border-line/60 pt-5">
          <summary className="cursor-pointer list-none rounded-xl py-2 font-display text-lg font-semibold text-ink outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-accent">
            账号与头像
            <span className="float-right text-sm font-normal text-ink-muted transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="pt-5">
            <ProfileSettings
              onUserChange={(nextUser) => {
                setUser((current) =>
                  current ? { ...current, ...nextUser } : current,
                );
                onUserChange?.(nextUser);
              }}
            />
          </div>
        </details>

        {conversationId ? (
          <details
            data-sheet-item
            className="group border-t border-line/60 pt-5"
          >
            <summary className="cursor-pointer list-none rounded-xl py-2 font-display text-lg font-semibold text-ink outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-accent">
              通信方式
              <span className="float-right text-sm font-normal text-ink-muted transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <div className="pt-5">
              <ConnectionSettings
                conversationId={conversationId}
                notebookTitle={notebookTitle ?? null}
              />
            </div>
          </details>
        ) : null}
      </div>
    </Sheet>
  );
}

function MiniStat({
  value,
  unit,
  label,
}: {
  value: number | null;
  unit: string;
  label: string;
}) {
  return (
    <div className="rounded-xl px-3 py-2 text-center">
      <p className="font-display text-lg font-semibold leading-none tabular-nums text-ink">
        <CountUp value={value} />
        {value !== null ? (
          <span className="ml-0.5 text-xs text-ink-muted">{unit}</span>
        ) : null}
      </p>
      <p className="mt-1 text-[11px] text-ink-muted">{label}</p>
    </div>
  );
}
