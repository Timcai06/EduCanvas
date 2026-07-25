'use client';

import { ArrowRight, GearSix, UserCircle } from '@phosphor-icons/react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  type LearningActivity,
  learningActivityResponseSchema,
} from '@/features/profile/activity-contract';
import { Sheet } from '@/features/workspace/shared/sheet';

interface CurrentUser {
  nickname: string;
  username?: string;
  avatarAvailable: boolean;
}

/**
 * 档案抽屉：从头像打开的「快速一瞥」。只放身份与两个入口，深入信息（热力图、掌握度、
 * 未来的成就与目标）在 /profile 完整页。抽屉=一瞥，页面=深入。
 */
export function ProfileDrawer({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [activity, setActivity] = useState<LearningActivity | null>(null);

  useEffect(() => {
    void fetch('/api/v1/me', { cache: 'no-store' })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { user: CurrentUser | null })
          : { user: null },
      )
      .then((body) => setUser(body.user))
      .catch(() => undefined);
  }, []);

  // 走正式接口 /api/v1/me/activity，按契约 schema 解析后展示可信统计。
  useEffect(() => {
    void fetch('/api/v1/me/activity', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const parsed = learningActivityResponseSchema.safeParse(body);
        if (parsed.success) setActivity(parsed.data.activity);
      })
      .catch(() => undefined);
  }, []);

  const go = (path: string) => {
    router.push(path);
    onClose();
  };

  return (
    <Sheet label="我的档案" eyebrow="Profile" onClose={onClose}>
      <div className="flex flex-col gap-6">
        <div data-sheet-item className="flex items-center gap-4">
          <span className="grid size-16 place-items-center overflow-hidden rounded-full border border-line bg-accent-soft text-accent">
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
            <p className="font-display text-xl font-semibold text-ink">
              {user?.nickname ?? '游客'}
            </p>
            <p className="mt-0.5 text-sm text-ink-muted">
              {user?.username
                ? `@${user.username}`
                : '未登录 · 记录只留在当前浏览器'}
            </p>
          </div>
        </div>

        {activity ? (
          <div
            data-sheet-item
            className="grid grid-cols-3 gap-2 rounded-2xl border border-line bg-surface/40 p-1"
          >
            <MiniStat value={activity.streakDays} unit="天" label="连续" />
            <MiniStat value={activity.activeDays} unit="天" label="活跃" />
            <MiniStat value={activity.masteryPercent} unit="%" label="掌握度" />
          </div>
        ) : null}

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

        <button
          data-sheet-item
          type="button"
          onClick={() => go('/settings')}
          className="group inline-flex min-h-11 items-center justify-between rounded-full border border-line px-5 text-sm font-medium text-ink transition-colors hover:border-accent/40 hover:bg-accent-soft"
        >
          <span className="inline-flex items-center gap-2">
            <GearSix aria-hidden="true" size={17} className="text-ink-muted" />
            账号设置
          </span>
          <ArrowRight
            aria-hidden="true"
            size={16}
            weight="bold"
            className="text-accent transition-transform group-hover:translate-x-0.5"
          />
        </button>
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
        {value ?? '—'}
        {value !== null ? (
          <span className="ml-0.5 text-xs text-ink-muted">{unit}</span>
        ) : null}
      </p>
      <p className="mt-1 text-[11px] text-ink-muted">{label}</p>
    </div>
  );
}
