'use client';

import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import './option-wheel.css';
import {
  clampOptionWheelIndex,
  type OptionWheelConfig,
  type OptionWheelProps,
} from './option-wheel-contract';
import { applyOptionWheelLayout } from './option-wheel-layout';

export type { OptionWheelProps } from './option-wheel-contract';

/**
 * React Bits OptionWheel 的 EduCanvas 适配层。
 *
 * 调用边界：只负责选项的弧形布局、漫游和激活，不持有 Studio 业务状态。传入
 * selectedIndex 时由上层控制；onChange 表示中心选项变化，onSelect 表示用户确认进入。
 */
export default function OptionWheel({
  items,
  selectedIndex,
  defaultSelected = 0,
  onChange,
  onSelect,
  activateOnItemClick = false,
  textColor = 'var(--color-ink-muted)',
  activeColor = 'var(--color-ink)',
  side = 'left',
  fontSize = 1.6,
  spacing = 1.55,
  curve = 1,
  tilt = 7,
  blur = 1.25,
  fade = 0.2,
  minOpacity = 0.08,
  smoothing = 180,
  inset = 38,
  loop = false,
  draggable = true,
  soundUrl = '',
  soundVolume = 0.35,
  ariaLabel = 'Studio 选项',
  className = '',
}: OptionWheelProps) {
  const initialIndex = clampOptionWheelIndex(
    selectedIndex ?? defaultSelected,
    items.length,
  );
  const rootFontSize =
    typeof window === 'undefined'
      ? 16
      : Number.parseFloat(
          getComputedStyle(document.documentElement).fontSize,
        ) || 16;
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const positionRef = useRef(initialIndex);
  const targetRef = useRef(initialIndex);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const configRef = useRef<OptionWheelConfig>({
    count: items.length,
    items,
    rowHeight: Math.max(fontSize * spacing * rootFontSize, 1),
    curve,
    tilt,
    blur,
    fade,
    minOpacity,
    side,
    loop,
    smoothing,
    draggable,
    soundUrl,
    soundVolume,
  });
  const onChangeRef = useRef(onChange);
  const onSelectRef = useRef(onSelect);
  const selectedRef = useRef(initialIndex);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ y: number; start: number; id: number } | null>(null);
  const dragMovedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef('');
  const lastTickRef = useRef(0);
  const [uncontrolledIndex, setUncontrolledIndex] = useState(initialIndex);
  const [isDragging, setIsDragging] = useState(false);
  const renderedIndex = clampOptionWheelIndex(
    selectedIndex ?? uncontrolledIndex,
    items.length,
  );

  const runFrame = useCallback(function animateWheel(now: number) {
    const deltaTime = Math.min((now - lastFrameRef.current) / 1000, 0.05);
    lastFrameRef.current = now;
    const config = configRef.current;
    const timeConstant = Math.max(config.smoothing, 1) / 1000;
    const easing = 1 - Math.exp(-deltaTime / timeConstant);
    const target = targetRef.current;
    const current = positionRef.current;
    let next = current + (target - current) * easing;
    const settled = Math.abs(target - next) < 0.001;
    if (settled) next = target;
    positionRef.current = next;

    applyOptionWheelLayout(config, itemRefs.current, next);

    animationFrameRef.current = settled
      ? null
      : requestAnimationFrame(animateWheel);
  }, []);

  const startLoop = useCallback(() => {
    if (animationFrameRef.current !== null) return;
    lastFrameRef.current = performance.now();
    animationFrameRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSelectRef.current = onSelect;
  }, [onChange, onSelect]);

  useEffect(() => {
    configRef.current = {
      count: items.length,
      items,
      rowHeight: Math.max(fontSize * spacing * rootFontSize, 1),
      curve,
      tilt,
      blur,
      fade,
      minOpacity,
      side,
      loop,
      smoothing,
      draggable,
      soundUrl,
      soundVolume,
    };
    startLoop();
  }, [
    activeColor,
    blur,
    curve,
    draggable,
    fade,
    fontSize,
    items,
    loop,
    minOpacity,
    rootFontSize,
    side,
    smoothing,
    soundUrl,
    soundVolume,
    spacing,
    startLoop,
    textColor,
    tilt,
  ]);

  const playTick = useCallback(() => {
    const { soundUrl: url, soundVolume: volume } = configRef.current;
    if (!url) return;
    const now = performance.now();
    if (now - lastTickRef.current < 70) return;
    lastTickRef.current = now;
    if (!audioRef.current || audioUrlRef.current !== url) {
      audioRef.current = new Audio(url);
      audioRef.current.preload = 'auto';
      audioUrlRef.current = url;
    }
    const audio = audioRef.current;
    audio.volume = Math.min(Math.max(volume, 0), 1);
    audio.currentTime = 0;
    audio.play().catch(() => undefined);
  }, []);

  const applyTarget = useCallback(
    (value: number, snap: boolean, notify = true) => {
      const config = configRef.current;
      if (config.count === 0) return;
      let next = value;
      if (!config.loop) {
        next = Math.min(Math.max(next, 0), config.count - 1);
      }
      if (snap) next = Math.round(next);
      targetRef.current = next;
      const index =
        ((Math.round(next) % config.count) + config.count) % config.count;
      if (index !== selectedRef.current) {
        selectedRef.current = index;
        if (selectedIndex === undefined) setUncontrolledIndex(index);
        if (notify) onChangeRef.current?.(index, config.items[index]!);
        if (notify) playTick();
      }

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        positionRef.current = next;
      }
      startLoop();
    },
    [playTick, selectedIndex, startLoop],
  );

  useEffect(() => {
    const next = clampOptionWheelIndex(
      selectedIndex ?? defaultSelected,
      items.length,
    );
    itemRefs.current.length = items.length;
    if (next !== selectedRef.current) {
      selectedRef.current = next;
      positionRef.current = next;
      targetRef.current = next;
    }
    startLoop();
  }, [defaultSelected, items, selectedIndex, startLoop]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const config = configRef.current;
      const delta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 24
          : event.deltaY;
      const step = Math.max(
        -1,
        Math.min(1, delta / Math.max(config.rowHeight, 1)),
      );
      applyTarget(targetRef.current + step, false);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(
        () => applyTarget(targetRef.current, true),
        140,
      );
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', handleWheel);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    };
  }, [applyTarget]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!configRef.current.draggable) return;
      dragRef.current = {
        y: event.clientY,
        start: targetRef.current,
        id: event.pointerId,
      };
      dragMovedRef.current = false;
      setIsDragging(true);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaY = event.clientY - drag.y;
      if (!dragMovedRef.current && Math.abs(deltaY) > 4) {
        dragMovedRef.current = true;
        rootRef.current?.setPointerCapture(drag.id);
      }
      if (dragMovedRef.current) {
        applyTarget(drag.start - deltaY / configRef.current.rowHeight, false);
      }
    },
    [applyTarget],
  );

  const handlePointerEnd = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsDragging(false);
    if (dragMovedRef.current) applyTarget(targetRef.current, true);
  }, [applyTarget]);

  const handleItemClick = useCallback(
    (index: number) => {
      if (dragMovedRef.current) return;
      if (index === selectedRef.current) {
        onSelectRef.current?.(index, configRef.current.items[index]!);
        return;
      }
      const config = configRef.current;
      const current = targetRef.current;
      let delta =
        index - (((current % config.count) + config.count) % config.count);
      if (config.loop && config.count > 1) {
        if (delta > config.count / 2) delta -= config.count;
        else if (delta < -config.count / 2) delta += config.count;
      }
      applyTarget(current + delta, true);
      if (activateOnItemClick) {
        onSelectRef.current?.(index, config.items[index]!);
      }
    },
    [activateOnItemClick, applyTarget],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const index = selectedRef.current;
        onSelectRef.current?.(index, configRef.current.items[index]!);
        return;
      }
      let delta: number | null = null;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') delta = -1;
      else if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
        delta = 1;
      if (delta === null) return;
      event.preventDefault();
      applyTarget(Math.round(targetRef.current) + delta, true);
    },
    [applyTarget],
  );

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      audioRef.current?.pause();
    },
    [],
  );

  return (
    <div
      ref={rootRef}
      role="listbox"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-activedescendant={`option-wheel-item-${renderedIndex}`}
      className={`studio-option-wheel${side === 'right' ? ' studio-option-wheel--right' : ''}${isDragging ? ' studio-option-wheel--dragging' : ''}${className ? ` ${className}` : ''}`}
      style={
        {
          '--ow-text-color': textColor,
          '--ow-active-color': activeColor,
          '--ow-font-size': `${fontSize}rem`,
          '--ow-inset': `${inset}px`,
        } as CSSProperties
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
    >
      {items.map((label, index) => (
        <div
          id={`option-wheel-item-${index}`}
          key={`${label}-${index}`}
          ref={(element) => {
            itemRefs.current[index] = element;
          }}
          role="option"
          aria-selected={renderedIndex === index}
          className={`studio-option-wheel__item${renderedIndex === index ? ' studio-option-wheel__item--selected' : ''}`}
          style={
            {
              transform: `translate(0, calc(${(index - renderedIndex) * fontSize * spacing}rem - 50%))`,
              opacity: Math.max(
                minOpacity,
                1 - Math.abs(index - renderedIndex) * fade,
              ),
              filter:
                blur > 0
                  ? `blur(${Math.abs(index - renderedIndex) * blur}px)`
                  : 'none',
              '--ow-proximity': index === renderedIndex ? 1 : 0,
            } as CSSProperties
          }
          onClick={() => handleItemClick(index)}
        >
          {label}
        </div>
      ))}
      <span className="studio-option-wheel__focus-line" aria-hidden="true" />
    </div>
  );
}
