'use client';

import { UserCircle } from '@phosphor-icons/react';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { ChangePasswordForm } from './change-password-form';

interface CurrentUser {
  username: string;
  nickname: string;
  avatarAvailable: boolean;
}

async function publicError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown };
    };
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // Stable fallback below keeps raw server failures out of the UI.
  }
  return fallback;
}

export function ProfileSettings() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [nickname, setNickname] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void fetch('/api/v1/me', { cache: 'no-store' })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { user: CurrentUser | null })
          : { user: null },
      )
      .then((body) => {
        if (active) {
          setUser(body.user);
          setNickname(body.user?.nickname ?? '');
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const saveNickname = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch('/api/v1/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nickname }),
      });
      if (!response.ok) {
        throw new Error(await publicError(response, '暂时无法更新资料。'));
      }
      const body = (await response.json()) as { user: CurrentUser };
      setUser(body.user);
      setNickname(body.user.nickname);
      setStatus('昵称已更新。');
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : '请求失败。');
    } finally {
      setBusy(false);
    }
  };

  const uploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const form = new FormData();
      form.set('avatar', file);
      const response = await fetch('/api/v1/me/avatar', {
        method: 'POST',
        body: form,
      });
      if (!response.ok) {
        throw new Error(await publicError(response, '暂时无法上传头像。'));
      }
      setUser((current) =>
        current ? { ...current, avatarAvailable: true } : current,
      );
      setAvatarVersion((version) => version + 1);
      setStatus('头像已更新。');
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : '请求失败。');
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  };

  if (!user) {
    return (
      <section className="rounded-3xl border border-line bg-card p-6 shadow-float sm:p-8">
        <h2 className="font-display text-xl font-semibold">个人资料</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          登录后可以修改昵称和头像。
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="rounded-3xl border border-line bg-card p-6 shadow-float sm:p-8">
        <div className="flex flex-wrap items-start gap-5">
          <div className="grid size-20 place-items-center overflow-hidden rounded-full bg-surface text-ink-muted">
            {user.avatarAvailable ? (
              <Image
                src={`/api/v1/me/avatar?v=${avatarVersion}`}
                alt=""
                width={80}
                height={80}
                unoptimized
                className="size-full object-cover"
              />
            ) : (
              <UserCircle aria-hidden="true" size={48} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-semibold">个人资料</h2>
            <p className="mt-1 text-sm text-ink-muted">@{user.username}</p>
            <label className="mt-4 inline-flex min-h-10 cursor-pointer items-center rounded-full border border-line px-4 text-sm font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink">
              上传头像
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={uploadAvatar}
                disabled={busy}
                className="sr-only"
              />
            </label>
          </div>
        </div>
        <form
          onSubmit={saveNickname}
          className="mt-6 flex flex-col gap-3 sm:flex-row"
        >
          <label className="min-w-0 flex-1">
            <span className="text-sm font-medium text-ink">昵称</span>
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              required
              maxLength={30}
              className="mt-1.5 h-11 w-full rounded-2xl border border-line bg-canvas px-4 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="mt-auto inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-card transition-colors hover:bg-accent-strong disabled:opacity-60"
          >
            保存
          </button>
        </form>
        {status ? (
          <p className="mt-3 text-sm text-ink-muted">{status}</p>
        ) : null}
      </section>
      <div className="mt-6">
        <ChangePasswordForm />
      </div>
    </>
  );
}
