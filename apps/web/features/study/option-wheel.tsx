'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 学科/学段滚轮（灵感来源：React Bits「OptionWheel」，改造为墨色 + 衬线）。
 * 选项沿一段圆弧排布、居中即选中；滚轮 / 拖拽 / 点击 / 方向键都能拨。视觉走令牌（见
 * globals.css .option-wheel*）。
 *
 * 工程改造（对齐项目规范，非照抄）：
 * - 动画与布局全在 effect 里装配，事件处理器经 ref 调用——绕开 React 编译器「render 期不得
 *   访问 ref」「useCallback 不得自引用」两条规则；
 * - reduced-motion 下把平滑时间常数压到≈0，选择瞬时到位、不做缓动旋转；
 * - 卸载时取消 rAF、移除 wheel 监听、清定时器、暂停音频，无泄漏；
 * - 默认无声（soundUrl 为空即禁用）。
 */
export interface OptionWheelProps {
  items: readonly string[];
  defaultSelected?: number;
  onChange?: (index: number, item: string) => void;
  ariaLabel?: string;
  className?: string;
  fontSize?: number;
  spacing?: number;
  curve?: number;
  tilt?: number;
  blur?: number;
  fade?: number;
  minOpacity?: number;
  smoothing?: number;
  inset?: number;
  loop?: boolean;
  draggable?: boolean;
  soundUrl?: string;
  soundVolume?: number;
}

export function OptionWheel({
  items,
  defaultSelected = 0,
  onChange,
  ariaLabel = '选项',
  className = '',
  fontSize = 1.9,
  spacing = 1.5,
  curve = 1,
  tilt = 7,
  blur = 2,
  fade = 0.28,
  minOpacity = 0.12,
  smoothing = 210,
  inset = 20,
  loop = false,
  draggable = true,
  soundUrl = '',
  soundVolume = 0.5,
}: OptionWheelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const posRef = useRef(defaultSelected);
  const targetRef = useRef(defaultSelected);
  const selectedRef = useRef(defaultSelected);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const rowHRef = useRef(1);
  const dragRef = useRef<{ y: number; start: number; id: number } | null>(null);
  const dragMovedRef = useRef(false);
  const applyRef = useRef<(value: number, snap: boolean) => void>(() => {});
  const onChangeRef = useRef(onChange);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastTickRef = useRef(0);
  const [selectedIndex, setSelectedIndex] = useState(defaultSelected);

  // onChange 单独经 ref 更新（不进主 effect 依赖，避免父级每次渲染都重装动画）。
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const remPx =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const rowH = Math.max(fontSize * spacing * remPx, 1);
    rowHRef.current = rowH;
    const n = items.length;
    const tiltRad = (tilt * Math.PI) / 180;
    const R = tiltRad > 0.0005 ? rowH / tiltRad : 0;
    const tau = Math.max(reduced ? 1 : smoothing, 1) / 1000;

    const layout = () => {
      const pos = posRef.current;
      for (let i = 0; i < n; i += 1) {
        const el = itemRefs.current[i];
        if (!el) continue;
        let d = i - pos;
        if (loop && n > 1) {
          d = ((d % n) + n) % n;
          if (d > n / 2) d -= n;
        }
        const dist = Math.abs(d);
        let x = 0;
        let y = d * rowH;
        let rot = 0;
        if (R > 0) {
          const ang = Math.max(
            -Math.PI / 2,
            Math.min(Math.PI / 2, d * tiltRad),
          );
          y = R * Math.sin(ang);
          x = -R * (1 - Math.cos(ang)) * curve;
          rot = (ang * 180) / Math.PI;
        }
        el.style.transform = `translate(${x.toFixed(2)}px, calc(${y.toFixed(2)}px - 50%)) rotate(${rot.toFixed(2)}deg)`;
        el.style.opacity = String(Math.max(minOpacity, 1 - dist * fade));
        el.style.filter =
          blur > 0 ? `blur(${(dist * blur).toFixed(2)}px)` : 'none';
        el.style.setProperty(
          '--ow-p',
          Math.max(0, 1 - Math.min(dist, 1)).toFixed(3),
        );
      }
    };

    const frame = (now: number) => {
      const dt = Math.min((now - lastRef.current) / 1000, 0.05);
      lastRef.current = now;
      const k = 1 - Math.exp(-dt / tau);
      let next = posRef.current + (targetRef.current - posRef.current) * k;
      const settled = Math.abs(targetRef.current - next) < 0.001;
      if (settled) next = targetRef.current;
      posRef.current = next;
      layout();
      rafRef.current = settled ? null : requestAnimationFrame(frame);
    };

    const start = () => {
      if (rafRef.current != null) return;
      lastRef.current = performance.now();
      rafRef.current = requestAnimationFrame(frame);
    };

    const playTick = () => {
      if (!soundUrl) return;
      const now = performance.now();
      if (now - lastTickRef.current < 70) return;
      lastTickRef.current = now;
      if (!audioRef.current) {
        audioRef.current = new Audio(soundUrl);
        audioRef.current.preload = 'auto';
      }
      const audio = audioRef.current;
      audio.volume = Math.min(Math.max(soundVolume, 0), 1);
      audio.currentTime = 0;
      void audio.play()?.catch(() => {});
    };

    const apply = (value: number, snap: boolean) => {
      let v = value;
      if (!loop) v = Math.min(Math.max(v, 0), Math.max(n - 1, 0));
      if (snap) v = Math.round(v);
      targetRef.current = v;
      const idx = ((Math.round(v) % n) + n) % n;
      if (idx !== selectedRef.current) {
        selectedRef.current = idx;
        setSelectedIndex(idx);
        onChangeRef.current?.(idx, items[idx]!);
        playTick();
      }
      start();
    };
    applyRef.current = apply;
    apply(targetRef.current, false);

    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 24 : event.deltaY;
      const step = Math.max(-1, Math.min(1, delta / rowH));
      apply(targetRef.current + step, false);
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => apply(targetRef.current, true), 140);
    };
    root.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      root.removeEventListener('wheel', onWheel);
      if (wheelTimer) clearTimeout(wheelTimer);
      audioRef.current?.pause();
    };
  }, [
    items,
    fontSize,
    spacing,
    curve,
    tilt,
    blur,
    fade,
    minOpacity,
    smoothing,
    loop,
    soundUrl,
    soundVolume,
  ]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable) return;
    dragRef.current = {
      y: event.clientY,
      start: targetRef.current,
      id: event.pointerId,
    };
    dragMovedRef.current = false;
    rootRef.current?.classList.add('option-wheel--dragging');
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dy = event.clientY - drag.y;
    if (!dragMovedRef.current && Math.abs(dy) > 4) {
      dragMovedRef.current = true;
      rootRef.current?.setPointerCapture(drag.id);
    }
    if (dragMovedRef.current)
      applyRef.current(drag.start - dy / rowHRef.current, false);
  };

  const onPointerEnd = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    rootRef.current?.classList.remove('option-wheel--dragging');
    if (dragMovedRef.current) applyRef.current(targetRef.current, true);
  };

  const onItemClick = (index: number) => {
    if (dragMovedRef.current) return;
    const n = items.length;
    const cur = targetRef.current;
    let d = index - (((cur % n) + n) % n);
    if (loop && n > 1) {
      if (d > n / 2) d -= n;
      else if (d < -n / 2) d += n;
    }
    applyRef.current(cur + d, true);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let delta = 0;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') delta = -1;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') delta = 1;
    else return;
    event.preventDefault();
    applyRef.current(Math.round(targetRef.current) + delta, true);
  };

  return (
    <div
      ref={rootRef}
      role="listbox"
      tabIndex={0}
      aria-label={ariaLabel}
      className={`option-wheel ${className}`.trim()}
      style={
        {
          '--ow-font-size': `${fontSize}rem`,
          '--ow-inset': `${inset}px`,
        } as React.CSSProperties
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      {items.map((label, index) => (
        <div
          key={`${label}-${index}`}
          ref={(el) => {
            itemRefs.current[index] = el;
          }}
          role="option"
          aria-selected={selectedIndex === index}
          onClick={() => onItemClick(index)}
          className={`option-wheel__item${selectedIndex === index ? ' option-wheel__item--selected' : ''}`}
        >
          {label}
        </div>
      ))}
    </div>
  );
}
