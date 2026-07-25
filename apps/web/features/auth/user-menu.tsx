'use client';

import { SignOut, UserCircle } from '@phosphor-icons/react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ProfileDrawer } from '@/features/profile/profile-drawer';
import { AuthDrawer } from './auth-drawer';

interface CurrentUser {
  nickname: string;
  avatarAvailable: boolean;
}

type AuthMode = 'login' | 'register';

export function UserMenu({
  conversationId,
  notebookTitle,
}: {
  conversationId?: string;
  notebookTitle?: string | null;
} = {}) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const loadUser = useCallback(() => {
    void fetch('/api/v1/me', { cache: 'no-store' })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { user: CurrentUser | null })
          : { user: null },
      )
      .then((body) => setUser(body.user))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  /*
   * 旧路由 /login、/register 现改为重定向到带 ?auth= 的首页（见各自 page.tsx），这里读取
   * 意图并自动弹开登录/注册抽屉，保住外链与书签的原意；随后清掉 query，避免刷新重复弹出。
   * 弹开状态推到微任务里再置：既避免「effect 内同步 setState」的级联渲染，也让首帧在
   * 服务端与客户端一致（抽屉初始都关闭），随后再按 URL 意图弹开，不产生水合不匹配。
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get('auth');
    const profile = params.get('profile');
    if (auth === 'login' || auth === 'register') {
      queueMicrotask(() => setAuthMode(auth));
      params.delete('auth');
    } else if (profile === '1') {
      queueMicrotask(() => setProfileOpen(true));
      params.delete('profile');
    } else {
      return;
    }
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (query ? `?${query}` : ''),
    );
  }, []);

  const logout = async () => {
    setLogoutBusy(true);
    setLogoutError(null);
    try {
      const response = await fetch('/api/v1/auth/logout', { method: 'POST' });
      if (!response.ok) {
        setLogoutError('暂时无法安全退出，请稍后重试。');
        return;
      }
      window.location.assign('/');
    } catch {
      setLogoutError('网络异常，暂时无法退出。');
    } finally {
      setLogoutBusy(false);
    }
  };

  return (
    <>
      {user ? (
        <div className="relative flex items-center gap-1.5">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={profileOpen}
            onClick={() => setProfileOpen(true)}
            className="inline-flex min-h-9 items-center gap-2 rounded-full px-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {user.avatarAvailable ? (
              // The avatar route revalidates the current session; no raw asset key is exposed to the browser.
              <Image
                src={`/api/v1/me/avatar?v=${profileVersion}`}
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
          </button>
          <button
            type="button"
            onClick={logout}
            disabled={logoutBusy}
            aria-label="退出登录"
            title="退出登录"
            className="grid size-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            <SignOut aria-hidden="true" size={17} />
          </button>
          {logoutError ? (
            <p
              role="alert"
              className="absolute right-0 top-11 z-20 w-52 rounded-2xl border border-line bg-card px-3 py-2 text-xs leading-5 text-cinnabar-strong shadow-float"
            >
              {logoutError}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setAuthMode('login')}
            className="inline-flex min-h-9 items-center rounded-full px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            登录
          </button>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setAuthMode('register')}
            className="inline-flex min-h-9 items-center rounded-full bg-ink px-3.5 text-sm font-semibold text-canvas transition-colors hover:bg-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            注册
          </button>
        </div>
      )}

      {authMode ? (
        <AuthDrawer
          initialMode={authMode}
          onClose={() => setAuthMode(null)}
          onSuccess={() => {
            setAuthMode(null);
            loadUser();
            router.refresh();
          }}
        />
      ) : null}
      {profileOpen ? (
        <ProfileDrawer
          conversationId={conversationId}
          notebookTitle={notebookTitle}
          onUserChange={(nextUser) => {
            setUser((current) =>
              current ? { ...current, ...nextUser } : current,
            );
            setProfileVersion((version) => version + 1);
          }}
          onClose={() => setProfileOpen(false)}
        />
      ) : null}
    </>
  );
}
