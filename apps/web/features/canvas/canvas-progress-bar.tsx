import type { KeyboardEvent, PointerEvent } from 'react';
import { useRef } from 'react';

/**
 * Canvas 内容渲染器共用的细进度条（reveal.js 的 scaleX 方案）：
 * 只动 transform 不改 width，避免逐帧重排；过渡交给 CSS。
 *
 * 传 onSeek 时整条轨道可点击跳转（分数由点击位置换算）；此时可访问性
 * 语义从 progressbar 升级为 slider，并提供方向键/Home/End 键盘通道。
 */
export function CanvasProgressBar({
  value,
  label,
  onSeek,
  className = '',
}: {
  /** 0..1；越界值在此收敛，调用方不必各自 clamp。 */
  value: number;
  label: string;
  onSeek?: (fraction: number) => void;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const clamped = Math.min(1, Math.max(0, value));

  const handleSeek = (event: PointerEvent<HTMLDivElement>) => {
    if (!onSeek || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    onSeek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    let next: number | null = null;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      next = Math.max(0, clamped - 0.05);
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      next = Math.min(1, clamped + 0.05);
    }
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    onSeek(next);
  };

  return (
    <div
      ref={trackRef}
      role={onSeek ? 'slider' : 'progressbar'}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      {...(onSeek
        ? { 'aria-valuetext': `${Math.round(clamped * 100)}%`, tabIndex: 0 }
        : {})}
      onPointerDown={onSeek ? handleSeek : undefined}
      onKeyDown={onSeek ? handleKeyDown : undefined}
      className={`relative h-1 overflow-hidden rounded-full bg-line/70 select-none ${
        onSeek ? 'cursor-pointer' : ''
      } ${className}`}
      data-canvas-progress=""
    >
      <span
        aria-hidden="true"
        className="block h-full w-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out motion-reduce:transition-none"
        style={{ transform: `scaleX(${clamped})` }}
      />
    </div>
  );
}
