'use client';

import { Eye, EyeSlash } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { assessPasswordRisk } from './password-strength';

type Mode = 'login' | 'register';

interface PublicError {
  error?: { message?: unknown };
}

async function publicError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as PublicError;
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // Keep the browser on a stable public message.
  }
  return fallback;
}

export function AuthForm({ mode }: { mode: Mode }) {
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const risk = useMemo(() => assessPasswordRisk(password), [password]);
  const isRegister = mode === 'register';

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isRegister && !risk.acceptable) {
      setError('密码至少需要 6 位。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        isRegister ? '/api/v1/auth/register' : '/api/v1/auth/login',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            username,
            password,
            ...(isRegister ? { nickname } : {}),
          }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await publicError(
            response,
            isRegister ? '暂时无法注册。' : '暂时无法登录。',
          ),
        );
      }
      window.location.assign('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '请求失败。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-ink">用户名</span>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
          minLength={3}
          maxLength={32}
          pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}"
          className="mt-1.5 h-11 w-full rounded-2xl border border-line bg-canvas px-4 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </label>
      {isRegister ? (
        <label className="block">
          <span className="text-sm font-medium text-ink">昵称</span>
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            required
            maxLength={30}
            className="mt-1.5 h-11 w-full rounded-2xl border border-line bg-canvas px-4 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
            placeholder="你想显示的名字"
          />
        </label>
      ) : null}
      <label className="block">
        <span className="text-sm font-medium text-ink">密码</span>
        <div className="relative mt-1.5">
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={6}
            type={passwordVisible ? 'text' : 'password'}
            className="h-11 w-full rounded-2xl border border-line bg-canvas px-4 pr-12 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
            placeholder="至少 6 位"
          />
          <button
            type="button"
            onClick={() => setPasswordVisible((visible) => !visible)}
            aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
            aria-pressed={passwordVisible}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-2xl text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            {passwordVisible ? (
              <EyeSlash aria-hidden="true" size={19} />
            ) : (
              <Eye aria-hidden="true" size={19} />
            )}
          </button>
        </div>
      </label>
      {isRegister ? (
        <div className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-muted">
          密码风险等级：
          <span
            className={
              risk.level === 'low'
                ? 'font-semibold text-green-700'
                : risk.level === 'medium'
                  ? 'font-semibold text-amber-700'
                  : 'font-semibold text-cinnabar-strong'
            }
          >
            {risk.label}
          </span>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-cinnabar-strong">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-card transition-colors hover:bg-accent-strong disabled:opacity-60"
      >
        {busy ? '处理中…' : isRegister ? '注册并登录' : '登录'}
      </button>
    </form>
  );
}
