'use client';

import { useState } from 'react';
import { AuthForm } from '@/features/auth/auth-form';

export function DesktopAuthorizeLogin() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  return (
    <div className="mt-6">
      <AuthForm mode={mode} onSuccess={() => window.location.reload()} />
      <button
        type="button"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        className="mt-4 min-h-11 text-sm font-medium text-accent transition-colors hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {mode === 'login' ? '第一次来？创建账号' : '已有账号？返回登录'}
      </button>
    </div>
  );
}
