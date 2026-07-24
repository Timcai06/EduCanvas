'use client';

import { Eye, EyeSlash } from '@phosphor-icons/react';
import { useId, useMemo, useState } from 'react';
import { assessPasswordRisk } from '@/features/auth/password-strength';

async function publicError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // The stable fallback prevents raw server failures from entering the settings UI.
  }
  return fallback;
}

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  const inputId = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="block">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative mt-1.5">
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          minLength={label === '新密码' ? 8 : undefined}
          maxLength={128}
          type={visible ? 'text' : 'password'}
          className="h-11 w-full rounded-2xl border border-line bg-canvas px-4 pr-12 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `隐藏${label}` : `显示${label}`}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-2xl text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          {visible ? (
            <EyeSlash aria-hidden="true" size={19} />
          ) : (
            <Eye aria-hidden="true" size={19} />
          )}
        </button>
      </div>
    </div>
  );
}

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const risk = useMemo(() => assessPasswordRisk(newPassword), [newPassword]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!risk.acceptable) {
      setStatus('新密码至少需要 8 位。');
      return;
    }
    if (newPassword !== confirmation) {
      setStatus('两次输入的新密码不一致。');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch('/api/v1/me/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        throw new Error(await publicError(response, '暂时无法修改密码。'));
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setStatus('密码已更新，其他设备需要重新登录。');
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : '请求失败。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-3xl border border-line bg-card p-6 shadow-float sm:p-8">
      <h2 className="font-display text-xl font-semibold">修改密码</h2>
      <p className="mt-2 text-sm leading-6 text-ink-muted">
        修改后，其他已登录设备需要重新登录。
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <PasswordField
          label="当前密码"
          value={currentPassword}
          onChange={setCurrentPassword}
        />
        <PasswordField
          label="新密码"
          value={newPassword}
          onChange={setNewPassword}
        />
        <PasswordField
          label="确认新密码"
          value={confirmation}
          onChange={setConfirmation}
        />
        <p className="text-sm text-ink-muted">
          密码风险等级：{' '}
          <span
            className={
              risk.level === 'low'
                ? 'font-semibold text-accent'
                : risk.level === 'medium'
                  ? 'font-semibold text-ink'
                  : 'font-semibold text-cinnabar-strong'
            }
          >
            {risk.label}
          </span>
        </p>
        {status ? (
          <p role="status" className="text-sm text-ink-muted">
            {status}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-card transition-colors hover:bg-accent-strong disabled:opacity-60"
        >
          {busy ? '正在更新…' : '更新密码'}
        </button>
      </form>
    </section>
  );
}
