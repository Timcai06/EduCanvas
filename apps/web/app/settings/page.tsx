import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, PlugsConnected } from '@phosphor-icons/react/dist/ssr';
import { ProfileSettings } from '@/features/settings/profile-settings';
import { ThemeToggle } from '@/features/theme/theme-toggle';
import { LogoMark } from '@/features/workspace/shared/logo-mark';

export const metadata: Metadata = { title: '设置 · EduCanvas' };
export const dynamic = 'force-dynamic';

/**
 * 设置完整页：设置抽屉「全部设置 →」的落地页。账号与外观可用；「通信方式」（gateway
 * 渠道）尚未接入，先放占位，接入后在此填充，不在抽屉里露出未完成的复杂 UI。
 */
export default function SettingsPage() {
  return (
    <main className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-line/70 bg-card/50">
        <div className="mx-auto max-w-3xl px-5 py-5 sm:px-8 sm:py-7">
          <Link
            href="/"
            className="group mb-6 inline-flex min-h-9 items-center gap-2 rounded-full pr-3 text-sm font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="grid size-9 place-items-center rounded-full transition-colors group-hover:bg-surface">
              <ArrowLeft aria-hidden="true" size={17} weight="bold" />
            </span>
            返回
          </Link>
          <div className="flex items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent shadow-float">
              <LogoMark size={26} />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
                Preferences
              </p>
              <h1 className="mt-0.5 font-display text-3xl font-semibold tracking-tight">
                设置
              </h1>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-8 px-5 py-8 sm:px-8 sm:py-10">
        <section className="rounded-3xl border border-line bg-card p-6 shadow-float sm:p-8">
          <ProfileSettings />
        </section>

        <section className="rounded-3xl border border-line bg-card p-6 shadow-float sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold">外观</h2>
              <p className="mt-1 max-w-md text-sm leading-6 text-ink-muted">
                纸色亮如白日铺纸，砚墨暗如晚自习灯下。默认跟随系统。
              </p>
            </div>
            <ThemeToggle />
          </div>
        </section>

        {/* 通信方式：gateway 渠道尚未接入，先占位，避免露出未完成的复杂 UI */}
        <section className="rounded-3xl border border-dashed border-line bg-surface/40 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-card text-ink-muted">
              <PlugsConnected aria-hidden="true" size={22} />
            </span>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="font-display text-xl font-semibold">通信方式</h2>
                <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">
                  敬请期待
                </span>
              </div>
              <p className="mt-1.5 max-w-md text-sm leading-6 text-ink-muted">
                把笔记本接到你常用的聊天渠道，随时随地继续和 AI
                老师的对话。功能正在打磨，接入后会在这里开放。
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
