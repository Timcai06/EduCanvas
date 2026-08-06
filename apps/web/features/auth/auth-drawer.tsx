'use client';

import { ArrowUpRight } from '@phosphor-icons/react';
import { useState } from 'react';
import { Sheet } from '@/components/sheet';
import { AuthForm } from './auth-form';

type Mode = 'login' | 'register';

/**
 * 登录 / 注册抽屉：取代 /login、/register 两个整页路由。同一个抽屉内切换两态
 * （对齐 ai-name 的 AuthDrawer），不跳页。成功后由 onSuccess 收尾（原地刷新 +
 * 关抽屉），交互不离开当前工作区。
 */
export function AuthDrawer({
  initialMode,
  onClose,
  onSuccess,
}: {
  initialMode: Mode;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const isRegister = mode === 'register';

  return (
    <Sheet
      label={isRegister ? '创建你的账号' : '继续学习旅程'}
      eyebrow={isRegister ? 'New account' : 'Welcome back'}
      onClose={onClose}
    >
      <div className="flex flex-col gap-6">
        <p
          data-sheet-item
          className="max-w-sm text-sm leading-7 text-ink-muted"
        >
          {isRegister
            ? '注册后可保存每一次学习、掌握度与产物，换设备也能从上次停下的地方继续。'
            : '登录后同步你的学习记录与笔记本，进度、掌握度与产物一处不丢。'}
        </p>

        <div data-sheet-item>
          <AuthForm mode={mode} onSuccess={onSuccess} />
        </div>

        <button
          data-sheet-item
          type="button"
          onClick={() => setMode(isRegister ? 'login' : 'register')}
          className="self-start text-sm font-medium text-accent transition-colors hover:text-accent-strong"
        >
          {isRegister ? '已有账号？返回登录' : '第一次来？创建账号'}
        </button>

        <div
          data-sheet-item
          className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint"
        >
          <span className="h-px flex-1 bg-line" />
          或
          <span className="h-px flex-1 bg-line" />
        </div>

        <button
          data-sheet-item
          type="button"
          onClick={onClose}
          className="group inline-flex min-h-11 items-center justify-between rounded-full border border-line px-5 text-sm font-medium text-ink transition-colors hover:border-accent/40 hover:bg-accent-soft"
        >
          <span>先不登录，随便逛逛</span>
          <ArrowUpRight
            aria-hidden="true"
            size={17}
            weight="bold"
            className="text-accent transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
        </button>
        <p data-sheet-item className="text-xs leading-5 text-ink-faint">
          未登录也能体验完整学习流程，但记录只留在当前浏览器、换设备会丢。
        </p>
      </div>
    </Sheet>
  );
}
