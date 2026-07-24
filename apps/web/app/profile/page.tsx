import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, GearSix, UserCircle } from '@phosphor-icons/react/dist/ssr';
import { AuroraInk } from '@/features/profile/aurora-ink';
import { LearningHeatmap } from '@/features/profile/learning-heatmap';
import { ProfileStats } from '@/features/profile/profile-stats';
import { SpotlightCard } from '@/features/profile/spotlight-card';
import { readCurrentWebUser } from '@/server/auth/current-user';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { getLearningActivity } from '@/server/profile/learning-activity-service';

export const metadata: Metadata = { title: '学习档案 · EduCanvas' };
export const dynamic = 'force-dynamic';

/**
 * 学习档案页：抽屉「查看完整档案 →」的落地页，也是后续堆放成就 / 目标时间线 / 错题本
 * 的地方。只读投影，不接受 URL 指定他人主体；活动数据经服务层取得（当前 mock，链路正式）。
 * 炫技集合（均尊重 reduced-motion）：Aurora 水墨极光头图、CountUp 数字上数、SpotlightCard
 * 跟随光斑、热力图波浪点亮、主按钮扫光——灵感来源见各组件注释（React Bits / GSAP）。
 */
export default async function ProfilePage() {
  const [user, identity] = await Promise.all([
    readCurrentWebUser(),
    readAnonymousIdentity(),
  ]);

  const activity = await getLearningActivity(
    identity?.studentId ?? 'demo-anon',
  );
  const hasActivity = activity.activeDays > 0;
  const displayName = user?.nickname ?? '游客';

  return (
    <main className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-line/70">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-4 sm:px-8">
          <Link
            href="/"
            className="group inline-flex min-h-9 items-center gap-2 rounded-full pr-3 text-sm font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="grid size-9 place-items-center rounded-full transition-colors group-hover:bg-surface">
              <ArrowLeft aria-hidden="true" size={17} weight="bold" />
            </span>
            返回
          </Link>
          <span className="flex-1" />
          <Link
            href="/settings"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3.5 text-sm font-medium text-ink-muted transition-colors hover:border-accent/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <GearSix aria-hidden="true" size={16} />
            设置
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
        {/* 身份头图：水墨极光作底 */}
        <div className="relative overflow-hidden rounded-3xl border border-line bg-card px-6 py-7 shadow-float sm:px-8">
          <AuroraInk />
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
              Profile
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-5">
              <span className="grid size-20 place-items-center overflow-hidden rounded-full border border-line bg-accent-soft text-accent shadow-float">
                {user?.avatarAvailable ? (
                  <Image
                    src="/api/v1/me/avatar"
                    alt=""
                    width={80}
                    height={80}
                    unoptimized
                    className="size-full object-cover"
                  />
                ) : (
                  <UserCircle aria-hidden="true" size={44} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-3xl font-semibold tracking-tight">
                  {displayName}
                </h1>
                <p className="mt-1 text-sm text-ink-muted">
                  {user ? `@${user.username}` : '未登录 · 记录只留在当前浏览器'}
                </p>
              </div>
              {user ? null : (
                <Link
                  href="/?auth=login"
                  className="shine-sweep inline-flex min-h-10 items-center rounded-full bg-accent px-5 text-sm font-semibold text-card transition-transform hover:-translate-y-0.5"
                >
                  登录以长期保存
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* 统计（CountUp + 跟随光斑） */}
        <div className="mt-6">
          <ProfileStats
            streakDays={activity.streakDays}
            totalSessions={activity.totalSessions}
            masteryPercent={activity.masteryPercent}
            activeDays={activity.activeDays}
          />
        </div>

        {/* 热力图 */}
        <SpotlightCard className="mt-6 rounded-3xl border border-line bg-card p-5 shadow-float sm:p-6">
          <h2 className="font-display text-lg font-semibold">学习热力图</h2>
          <p className="mb-4 mt-1 text-sm text-ink-muted">
            过去一年，每一格是一天；判分练习越多，墨色越深越密。
          </p>
          {hasActivity ? (
            <LearningHeatmap days={activity.days} />
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-surface/50 px-5 py-10 text-center">
              <p className="text-sm leading-6 text-ink-muted">
                还没有学习记录。开始上课后，这里会一天天染上墨色。
              </p>
              <Link
                href="/"
                className="shine-sweep mt-4 inline-flex min-h-10 items-center rounded-full bg-accent px-5 text-sm font-semibold text-card transition-transform hover:-translate-y-0.5"
              >
                去开始学习
              </Link>
            </div>
          )}
        </SpotlightCard>
      </div>
    </main>
  );
}
