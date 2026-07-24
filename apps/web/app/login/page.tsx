import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthForm } from '@/features/auth/auth-form';
import { LogoMark } from '@/features/workspace/shared/logo-mark';

export const metadata: Metadata = { title: '登录 · EduCanvas' };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 text-ink">
      <section className="w-full max-w-md rounded-3xl border border-line bg-card p-8 shadow-float">
        <div className="mb-7 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent-strong">
            <LogoMark size={24} />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
              EduCanvas
            </p>
            <h1 className="font-display text-2xl font-semibold">登录</h1>
          </div>
        </div>
        <AuthForm mode="login" />
        <p className="mt-5 text-center text-sm text-ink-muted">
          还没有账号？
          <Link href="/register" className="font-medium text-accent-strong">
            去注册
          </Link>
        </p>
      </section>
    </main>
  );
}
