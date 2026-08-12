import type { Metadata } from 'next';
import Link from 'next/link';
import { Desktop, ShieldCheck } from '@phosphor-icons/react/dist/ssr';
import { gatewayDesktopAuthorizationQuerySchema } from '@educanvas/gateway-core';
import { ProductMark } from '@/components/ProductMark';
import { readCurrentWebUser } from '@/server/auth/current-user';
import { DesktopAuthorizeLogin } from './desktop-authorize-login';

export const metadata: Metadata = { title: '连接桌宠 · EduCanvas' };
export const dynamic = 'force-dynamic';

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

export default async function DesktopAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const request = gatewayDesktopAuthorizationQuerySchema.safeParse({
    response_type: single(raw.response_type),
    client_id: single(raw.client_id),
    redirect_uri: single(raw.redirect_uri),
    state: single(raw.state),
    code_challenge: single(raw.code_challenge),
    code_challenge_method: single(raw.code_challenge_method),
  });
  const user = request.success ? await readCurrentWebUser() : null;

  return (
    <main className="min-h-dvh bg-canvas px-5 py-8 text-ink sm:py-12">
      <div className="mx-auto w-full max-w-md">
        <ProductMark href="/" />
        <section className="mt-8 rounded-3xl border border-line bg-card p-6 shadow-float sm:p-8">
          <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
            {request.success ? (
              <Desktop aria-hidden="true" size={25} weight="duotone" />
            ) : (
              <ShieldCheck aria-hidden="true" size={25} weight="duotone" />
            )}
          </span>
          <p className="mt-5 text-overline font-semibold uppercase tracking-[0.2em] text-accent">
            Desktop authorization
          </p>
          <h1 className="mt-2 font-display text-2xl font-semibold">
            {request.success ? '连接 EduCanvas 桌宠' : '授权请求无效'}
          </h1>

          {!request.success ? (
            <div role="alert">
              <p className="mt-4 text-sm leading-7 text-ink-muted">
                这个授权链接不完整或已经被修改。请返回桌宠重新发起登录。
              </p>
              <Link
                href="/"
                className="mt-6 inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-semibold text-ink hover:bg-surface"
              >
                返回 EduCanvas
              </Link>
            </div>
          ) : user ? (
            <>
              <p className="mt-4 text-sm leading-7 text-ink-muted">
                将以{' '}
                <strong className="font-semibold text-ink">
                  {user.nickname}
                </strong>{' '}
                的身份连接当前 Web 对话。桌宠会复用同一个 Notebook、AI
                老师与上下文；它不会读取浏览器密码。
              </p>
              <div className="mt-5 flex gap-3 rounded-2xl bg-surface px-4 py-3 text-sm leading-6 text-ink-muted">
                <ShieldCheck
                  aria-hidden="true"
                  size={20}
                  className="mt-0.5 shrink-0 text-accent"
                />
                <span>
                  授权可撤销，长期凭据仅保存在操作系统保护的安全存储中。
                </span>
              </div>
              <form
                action="/api/v1/desktop-auth/authorize"
                method="post"
                className="mt-6 grid gap-3"
              >
                {Object.entries(request.data).map(([name, value]) => (
                  <input key={name} type="hidden" name={name} value={value} />
                ))}
                <button
                  type="submit"
                  className="shine-sweep inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-card transition-transform hover:-translate-y-0.5 hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                >
                  授权并返回桌宠
                </button>
                <Link
                  href="/"
                  className="inline-flex min-h-11 items-center justify-center rounded-full text-sm font-medium text-ink-muted hover:text-ink"
                >
                  暂不连接
                </Link>
              </form>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm leading-7 text-ink-muted">
                请先登录 EduCanvas。登录成功后会留在本页，由你确认是否连接桌宠。
              </p>
              <DesktopAuthorizeLogin />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
