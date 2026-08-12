import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { UserCircle } from '@phosphor-icons/react/dist/ssr';
import { ProductMark } from '@/components/ProductMark';
import { AuroraInk } from '@/features/profile/aurora-ink';
import { LearningHeatmap } from '@/features/profile/learning-heatmap';
import { ProfileStats } from '@/features/profile/profile-stats';
import { readCurrentWebUser } from '@/server/auth/current-user';
import {
  projectPublicEffectiveSubject,
  readEffectiveSubject,
} from '@/server/identity/effective-subject';
import { getLearningActivity } from '@/server/profile/learning-activity-service';

export const metadata: Metadata = { title: '学习档案 · EduCanvas' };
export const dynamic = 'force-dynamic';

/**
 * 学习档案页：抽屉「查看完整档案 →」的落地页，也是后续堆放成就 / 目标时间线 / 错题本
 * 的地方。只读投影，不接受 URL 指定他人主体；活动数据只来自服务端可信事实。
 * 炫技集合（均尊重 reduced-motion）：Aurora 水墨极光头图、CountUp 数字上数、SpotlightCard
 * 跟随光斑、热力图波浪点亮、主按钮扫光——灵感来源见各组件注释（React Bits / GSAP）。
 */
export default async function ProfilePage() {
  const subject = await readEffectiveSubject();
  const user = await readCurrentWebUser(subject.registeredSession);
  const publicSubject = projectPublicEffectiveSubject(subject, {
    profileAvailable: user !== null,
  });

  const activity = await getLearningActivity(subject.dataOwnerId);
  const hasActivity = activity.activeDays > 0;
  const displayName = user?.nickname ?? '游客';
  const ownershipExplanation =
    publicSubject.dataOwner === 'local'
      ? user
        ? '账号只用于登录和资料；学习记录仍属于此本地实例，不会自动迁移到账号。'
        : '本地模式的学习记录属于此 EduCanvas 实例。'
      : publicSubject.dataOwner === 'registered'
        ? '学习记录属于当前登录账号。'
        : publicSubject.dataOwner === 'anonymous'
          ? '学习记录属于当前浏览器匿名主体；登录不会自动迁移已有记录。'
          : '尚未建立可读取学习记录的数据主体。';

  return (
    <main className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-line/70">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-4 sm:px-8">
          <ProductMark href="/" />
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
                <h1 className="font-display text-3xl font-semibold tracking-[0.025em]">
                  {displayName}
                </h1>
                <p className="mt-1 text-sm text-ink-muted">
                  {user ? `@${user.username}` : '未登录 · 记录只留在当前浏览器'}
                </p>
                <p className="mt-2 max-w-xl text-xs leading-5 text-ink-muted">
                  {ownershipExplanation}
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
        <section className="mt-6 rounded-3xl border border-line bg-card p-5 shadow-float sm:p-6">
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
        </section>
      </div>
    </main>
  );
}
