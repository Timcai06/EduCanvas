import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import { ConnectionSettings } from '@/features/settings/connection-settings';
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
    <main className="min-h-dvh bg-canvas px-4 py-6 text-ink sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 flex items-center gap-4">
          <Link
            href="/"
            aria-label="返回对话"
            className="grid size-10 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ArrowLeft aria-hidden="true" size={19} weight="bold" />
          </Link>
          <LogoMark size={24} />
          <div>
            <p className="text-xs font-medium tracking-wide text-ink-faint">
              EDUCANVAS 设置
            </p>
            <h1 className="font-display text-2xl font-semibold sm:text-3xl">
              通信方式
            </h1>
          </div>
        </header>

        {conversation ? (
          <ConnectionSettings
            conversationId={conversation.id}
            notebookTitle={conversation.title}
          />
        ) : (
          <section className="rounded-3xl border border-line bg-card p-8 text-center shadow-float">
            <h2 className="font-display text-xl font-semibold">
              先创建一个笔记本
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              通信方式必须连接到一个明确的笔记本，避免消息进入错误的上下文。
            </p>
            <Link
              href="/"
              className="mt-5 inline-flex min-h-10 items-center rounded-full bg-accent px-5 text-sm font-semibold text-card hover:bg-accent-strong"
            >
              返回开始
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
