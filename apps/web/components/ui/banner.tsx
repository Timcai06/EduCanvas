'use client';

import {
  CheckCircle,
  Info,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/*
 * 状态横幅（Banner）：info/success/warn/error 语义（含图标 + 语义色 bg/文字），
 * 语义由图标 + 文本共同承载（色弱不单靠颜色）；可选动作按钮。只消费 globals.css 语义 token。
 * 无 dismiss 状态：关闭由调用方接管（受控），保持组件状态最简。
 */
const TONES = {
  info: 'border-accent/30 bg-accent-soft/60 text-accent-strong',
  success: 'border-good/30 bg-good-soft/60 text-good',
  warn: 'border-warn/30 bg-warn-soft/60 text-warn',
  error: 'border-bad/30 bg-bad-soft/60 text-bad',
} as const;

const ICONS = {
  info: Info,
  success: CheckCircle,
  warn: WarningCircle,
  error: XCircle,
} as const;

type BannerTone = keyof typeof TONES;

interface BannerProps {
  tone?: BannerTone;
  title: string;
  description?: string;
  /** 动作按钮（如「查看详情」），由调用方注入。 */
  action?: ReactNode;
  className?: string;
}

export function Banner({
  tone = 'info',
  title,
  description,
  action,
  className = '',
}: BannerProps) {
  const Icon = ICONS[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${TONES[tone]} ${className}`}
    >
      <Icon aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="mt-0.5 text-xs opacity-90">{description}</p>
        ) : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}

export default Banner;
