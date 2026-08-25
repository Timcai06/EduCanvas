'use client';

import { SignOut, UserCircle } from '@phosphor-icons/react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ProfileDrawer } from '@/features/profile/profile-drawer';
import { AuthDrawer } from './auth-drawer';

interface CurrentUser {
  nickname: string;
  username?: string;
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
   * 旧路由 /login、/register 现改为重定向到带 ?auth= 的首页（见各自 page.tsx），这里读取意图并
   * 自动弹开登录/注册抽屉，保住外链与书签的原意。
   * 关键：不在这里 strip query，而是等到抽屉真正打开后（下方按 authMode/profileOpen 的 effect）
   * 再清除——Suspense/水合导致的组件重挂载会重置组件 state，若提前 strip，重挂载后再读不到参数；
   * 让参数存活到抽屉打开，重挂载就能重新读参并再次弹出。setState 用 setTimeout(0) 推迟到水合提交
   * 结束后（queueMicrotask 在水合窗口内被吞、直接 setState 又会触发 react-hooks/set-state-in-effect），
   * 且不在此 effect 内同步 strip，避免刷新重复弹出。
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get('auth');
    const profile = params.get('profile');
    if (auth === 'login' || auth === 'register') {
      setTimeout(() => setAuthMode(auth), 0);
    } else if (profile === '1') {
      setTimeout(() => setProfileOpen(true), 0);
    }
  }, []);

  // 抽屉真正打开后再清掉 query，避免刷新重复弹出；此时深链意图已被消费。
  useEffect(() => {
    if (authMode || profileOpen) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [authMode, profileOpen]);

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
            /* Q05：昵称 span 在窄屏（<sm）隐藏，按钮的可访问名因此为空；
               固定 aria-label 让移动端与读屏仍可识别该菜单按钮。 */
            aria-label={user.nickname}
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
          initialUser={user}
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
