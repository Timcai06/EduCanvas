import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import { ConnectionSettings } from '@/features/settings/connection-settings';
import { ThemeToggle } from '@/features/theme/theme-toggle';
import { LogoMark } from '@/features/workspace/shared/logo-mark';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';

export const metadata: Metadata = { title: '通信方式 — EduCanvas' };
export const dynamic = 'force-dynamic';

/** 设置页只使用服务端恢复的当前主体与 Conversation，不接受 URL 自报绑定目标。 */
export default async function SettingsPage() {
  const identity = await readAnonymousIdentity();
  const conversation = identity
    ? await loadOwnedGeneralConversation(identity)
    : null;
  return (
    <main className="min-h-dvh bg-canvas text-ink">
      {/* 扉页式页眉：一条黛青细纹带 + 朱砂标记，和工作区同一「纸墨」身份 */}
      <div className="border-b border-line/70 bg-card/50">
        <div className="mx-auto max-w-4xl px-4 py-5 sm:px-8 sm:py-7">
          <Link
            href="/"
            className="group mb-6 inline-flex min-h-9 items-center gap-2 rounded-full pr-3 text-sm font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="grid size-9 place-items-center rounded-full transition-colors group-hover:bg-surface">
              <ArrowLeft aria-hidden="true" size={17} weight="bold" />
            </span>
            返回对话
          </Link>
          <div className="flex items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent-strong shadow-float">
              <LogoMark size={26} />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                EduCanvas 设置
              </p>
              <h1 className="mt-0.5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                通信方式
              </h1>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">
            把这个笔记本接到你常用的聊天渠道，随时随地继续和 AI 老师的对话。
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-8 sm:py-10">
        {/* 外观：主题与 Notebook 无关，始终可见，不依赖是否已创建笔记本 */}
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

        {conversation ? (
          <ConnectionSettings
            conversationId={conversation.id}
            notebookTitle={conversation.title}
          />
        ) : (
          <section className="rounded-3xl border border-line bg-card p-10 text-center shadow-float">
            <h2 className="font-display text-xl font-semibold">
              先创建一个笔记本
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-muted">
              通信方式必须连接到一个明确的笔记本，避免消息进入错误的上下文。
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex min-h-10 items-center rounded-full bg-accent px-5 text-sm font-semibold text-card transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              返回开始
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
