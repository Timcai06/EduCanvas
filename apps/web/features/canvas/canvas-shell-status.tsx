'use client';

import {
  CloudSlash,
  LockKey,
  SpinnerGap,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  CANVAS_SHELL_COPY_CLASS,
  canRetryCanvasShellStatus,
  getCanvasShellStatusRole,
  isCanvasShellStatusBusy,
  resolveCanvasShellRetryLabel,
  type CanvasShellStatusKind,
} from './canvas-shell-status-contract';

export type { CanvasShellStatusKind } from './canvas-shell-status-contract';

/**
 * Canvas 外壳可展示的五种统一状态。
 *
 * 本组件是纯展示——不读取资源、不发请求、不判断权限。文案和是否需要
 * 重试完全由调用方提供，失败信息不得包含堆栈、对象键或 Provider 原始错误。
 */
export interface CanvasShellStatusProps {
  status: CanvasShellStatusKind;
  /** 面向用户的稳定标题，不展示内部错误码。 */
  title: string;
  /** 可选附加说明，不得包含对象键、堆栈或 Provider 消息。 */
  description?: string;
  /** 仅 failed / unavailable 状态可展示重试按钮。 */
  onRetry?: () => void;
  retryLabel?: string;
}

const iconProps = {
  size: 32,
  weight: 'duotone' as const,
  'aria-hidden': true,
};

function StatusIcon({ status }: { status: CanvasShellStatusKind }) {
  switch (status) {
    case 'loading':
      return <SpinnerGap {...iconProps} className="animate-spin text-accent" />;
    case 'empty':
      return (
        <svg
          width={32}
          height={32}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          className="text-ink-muted"
          aria-hidden
        >
          <rect x={3} y={3} width={18} height={18} rx={2} />
          <line x1={9} y1={9} x2={15} y2={9} />
          <line x1={9} y1={13} x2={13} y2={13} />
        </svg>
      );
    case 'failed':
      return <WarningCircle {...iconProps} className="text-accent" />;
    case 'unavailable':
      return <CloudSlash {...iconProps} className="text-ink-muted" />;
    case 'forbidden':
      return <LockKey {...iconProps} className="text-ink-muted" />;
    case 'not_found':
      return (
        <svg
          width={32}
          height={32}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          className="text-ink-muted"
          aria-hidden
        >
          <circle cx={11} cy={11} r={7} />
          <line x1={21} y1={21} x2={16.65} y2={16.65} />
        </svg>
      );
    case 'offline':
      return <CloudSlash {...iconProps} className="text-accent" />;
  }
}

/**
 * Canvas 外壳统一状态提示。
 *
 * 只接收安全文案和可选重试回调，不读取资源、不发请求、不判断权限。
 * 失败状态不允许展示 Provider 原始错误、堆栈或对象键——这些信息
 * 在调用方传入之前必须完成脱敏。
 */
export function CanvasShellStatus({
  status,
  title,
  description,
  onRetry,
  retryLabel = '重试',
}: CanvasShellStatusProps) {
  const showRetry = canRetryCanvasShellStatus(status, onRetry);

  return (
    <div
      role={getCanvasShellStatusRole(status)}
      aria-label={title}
      aria-busy={isCanvasShellStatusBusy(status)}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center"
    >
      <StatusIcon status={status} />
      <p className="font-display min-w-0 max-w-sm break-words text-base font-semibold text-ink">
        {title}
      </p>
      {description ? (
        <p className={CANVAS_SHELL_COPY_CLASS}>{description}</p>
      ) : null}
      {showRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 flex min-h-9 items-center rounded-full px-4 text-sm text-accent transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {resolveCanvasShellRetryLabel(retryLabel)}
        </button>
      ) : null}
    </div>
  );
}
