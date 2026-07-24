'use client';

import { SignOut, UserCircle } from '@phosphor-icons/react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface CurrentUser {
  nickname: string;
  avatarAvailable: boolean;
}

export function UserMenu() {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    let active = true;
    void fetch('/api/v1/me', { cache: 'no-store' })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { user: CurrentUser | null })
          : { user: null },
      )
      .then((body) => {
        if (active) setUser(body.user);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const logout = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    window.location.assign('/');
  };

  if (!user) {
    return (
      <div className="flex items-center gap-1.5">
        <Link
          href="/login"
          className="inline-flex min-h-9 items-center rounded-full px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          登录
        </Link>
        <Link
          href="/register"
          className="inline-flex min-h-9 items-center rounded-full bg-ink px-3.5 text-sm font-semibold text-canvas transition-colors hover:bg-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          注册
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Link
        href="/settings"
        className="inline-flex min-h-9 items-center gap-2 rounded-full px-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {user.avatarAvailable ? (
          // The avatar route revalidates the current session; no raw asset key is exposed to the browser.
          <Image
            src="/api/v1/me/avatar"
            alt=""
            width={28}
            height={28}
            unoptimized
            className="size-7 rounded-full object-cover"
          />
        ) : (
          <UserCircle aria-hidden="true" size={24} />
        )}
        <span className="hidden max-w-24 truncate sm:inline">
          {user.nickname}
        </span>
      </Link>
      <button
        type="button"
        onClick={logout}
        aria-label="退出登录"
        title="退出登录"
        className="grid size-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <SignOut aria-hidden="true" size={17} />
      </button>
    </div>
  );
}
