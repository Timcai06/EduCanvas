'use client';

import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { GENERATED_SOFT_CLICK, playSoftClick } from './option-wheel-sound';
import './OptionWheel.css';

type Side = 'left' | 'right';

/**
 * 滚轮条目。`id` 用作 React key，必须在同一份 items 内唯一且跨重排稳定——
 * 用下标或标题当 key 会在列表重排（如产物按更新时间重新排序）时错配 DOM，
 * 让正在播放的位移补间落到别的条目上。
 *
 * `secondary` 是次要说明（状态、版本号等），不参与选中语义，只影响呈现；
 * 把状态拼进 `label` 会让屏幕阅读器把它读成条目名称的一部分。
 */
export interface OptionWheelItem {
  id: string;
  label: string;
  secondary?: string;
  /** 空态占位这类不可选条目：仍可滚过，但不会触发 onSelect。 */
  disabled?: boolean;
}

/** 纯导航场景可以继续直接传字符串，内部会归一化成 OptionWheelItem。 */
export type OptionWheelInput = string | OptionWheelItem;

export interface OptionWheelProps {
  items?: readonly OptionWheelInput[];
  defaultSelected?: number;
  onChange?: (index: number, item: OptionWheelItem) => void;
  onSelect?: (index: number, item: OptionWheelItem) => void;
  textColor?: string;
  activeColor?: string;
  side?: Side;
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
  ariaLabel?: string;
  idPrefix?: string;
  className?: string;
}

interface WheelConfig {
  count: number;
  items: readonly OptionWheelItem[];
  rowH: number;
  curve: number;
  tilt: number;
  blur: number;
  fade: number;
  minOpacity: number;
  side: Side;
  loop: boolean;
  smoothing: number;
  draggable: boolean;
  soundUrl: string;
  soundVolume: number;
  reducedMotion: boolean;
}

const DEFAULT_ITEMS = [
  'Ambient',
  'House',
  'Techno',
  'Jazz',
  'Lo-Fi',
  'Synthwave',
  'Trance',
  'Funk',
  'Disco',
  'Hip-Hop',
  'Chillwave',
  'Drum & Bass',
];

function normalizeItem(item: OptionWheelInput, index: number): OptionWheelItem {
  return typeof item === 'string'
    ? { id: `${index}:${item}`, label: item }
    : item;
}

const OptionWheel = ({
  items: rawItems = DEFAULT_ITEMS,
  defaultSelected = 3,
  onChange,
  onSelect,
  textColor = '#a6a6a6',
  activeColor = '#ffffff',
  side = 'left',
  fontSize = 3,
  spacing = 1.4,
  curve = 1,
  tilt = 6,
  blur = 2,
  fade = 0.25,
  minOpacity = 0.05,
  smoothing = 200,
  inset = 80,
  loop = false,
  draggable = true,
  soundUrl = '',
  soundVolume = 0.5,
  ariaLabel = 'Option wheel',
  idPrefix = 'studio-option-wheel',
  className = '',
}: OptionWheelProps) => {
  const items = useMemo(() => rawItems.map(normalizeItem), [rawItems]);
  const remPx =
    typeof window !== 'undefined'
      ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      : 16;
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const posRef = useRef(defaultSelected);
  const targetRef = useRef(defaultSelected);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const cfgRef = useRef<WheelConfig>({
    count: items.length,
    items,
    rowH: Math.max(fontSize * spacing * remPx, 1),
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
    /* 与下方 reducedMotion state 的初值一致；真实取值由 effect 纠正。 */
    reducedMotion: false,
  });
  const onChangeRef = useRef(onChange);
  const onSelectRef = useRef(onSelect);
  const selectedRef = useRef(defaultSelected);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ y: number; start: number; id: number } | null>(null);
  const dragMovedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generatedAudioContextRef = useRef<AudioContext | null>(null);
  const audioUrlRef = useRef('');
  const lastTickRef = useRef(0);
  const [selectedIndex, setSelectedIndex] = useState(defaultSelected);
  const [isDragging, setIsDragging] = useState(false);
  /* SSR 与首帧一律按“允许动效”渲染，再由 effect 纠正，避免水合前后不一致。 */
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const onChangeMotion = () => setReducedMotion(query.matches);
    query.addEventListener('change', onChangeMotion);
    return () => query.removeEventListener('change', onChangeMotion);
  }, []);

  // Single rAF loop that eases the wheel position toward its target with
  // frame-rate independent exponential smoothing, then lays every option out
  // along the curve based on its distance from the current position.
  const runFrame = useCallback(function animateWheel(now: number) {
    const dt = Math.min((now - lastRef.current) / 1000, 0.05);
    lastRef.current = now;
    const cfg = cfgRef.current;
    /* reduced-motion 下把时间常数压到≈0：选中瞬时到位，不做缓动旋转。
       与 features/study/option-wheel.tsx 的处理保持一致。 */
    const tau = Math.max(cfg.reducedMotion ? 1 : cfg.smoothing, 1) / 1000;
    const k = 1 - Math.exp(-dt / tau);

    const target = targetRef.current;
    const cur = posRef.current;
    let next = cur + (target - cur) * k;
    const settled = Math.abs(target - next) < 0.001;
    if (settled) next = target;
    posRef.current = next;

    const els = itemRefs.current;
    const n = cfg.count;
    const mirror = cfg.side === 'right' ? -1 : 1;
    // Options sit on a circle whose radius keeps the arc length between two
    // neighbors equal to one row height, so tilt controls how tightly it curls.
    const tiltRad = (cfg.tilt * Math.PI) / 180;
    const R = tiltRad > 0.0005 ? cfg.rowH / tiltRad : 0;
    for (let i = 0; i < n; i++) {
      const el = els[i];
      if (!el) continue;
      let d = i - next;
      if (cfg.loop && n > 1) {
        d = ((d % n) + n) % n;
        if (d > n / 2) d -= n;
      }
      const dist = Math.abs(d);
      let x = 0;
      let y = d * cfg.rowH;
      let rot = 0;
      if (R > 0) {
        const ang = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, d * tiltRad));
        y = R * Math.sin(ang);
        x = -mirror * R * (1 - Math.cos(ang)) * cfg.curve;
        rot = (mirror * ang * 180) / Math.PI;
      }
      el.style.transform = `translate(${x.toFixed(2)}px, calc(${y.toFixed(2)}px - 50%)) rotate(${rot.toFixed(3)}deg)`;
      el.style.opacity = String(Math.max(cfg.minOpacity, 1 - dist * cfg.fade));
      const blur = cfg.reducedMotion ? 0 : cfg.blur;
      el.style.filter =
        blur > 0 ? `blur(${(dist * blur).toFixed(2)}px)` : 'none';
      el.style.setProperty(
        '--ow-p',
        Math.max(0, 1 - Math.min(dist, 1)).toFixed(4),
      );
    }

    rafRef.current = settled ? null : requestAnimationFrame(animateWheel);
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current != null) return;
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSelectRef.current = onSelect;
  }, [onChange, onSelect]);

  useLayoutEffect(() => {
    cfgRef.current = {
      count: items.length,
      items,
      rowH: Math.max(fontSize * spacing * remPx, 1),
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
      reducedMotion,
    };
    runFrame(performance.now());
  }, [
    blur,
    curve,
    draggable,
    fade,
    fontSize,
    items,
    loop,
    minOpacity,
    reducedMotion,
    remPx,
    side,
    smoothing,
    soundUrl,
    soundVolume,
    spacing,
    tilt,
    runFrame,
  ]);

  // Optional tick on selection change, throttled so fast scrolling can't spam
  // it, and with playback failures (e.g. autoplay policies) silently ignored.
  const playTick = useCallback(() => {
    const { soundUrl, soundVolume } = cfgRef.current;
    if (!soundUrl) return;
    const now = performance.now();
    if (now - lastTickRef.current < 70) return;
    lastTickRef.current = now;
    if (soundUrl === GENERATED_SOFT_CLICK) {
      generatedAudioContextRef.current = playSoftClick(
        generatedAudioContextRef.current,
        soundVolume,
      );
      return;
    }
    if (!audioRef.current || audioUrlRef.current !== soundUrl) {
      audioRef.current = new Audio(soundUrl);
      audioRef.current.preload = 'auto';
      audioUrlRef.current = soundUrl;
    }
    const audio = audioRef.current;
    audio.volume = Math.min(Math.max(soundVolume, 0), 1);
    audio.currentTime = 0;
    audio.play()?.catch(() => {});
  }, []);

  const applyTarget = useCallback(
    (value: number, snap: boolean) => {
      const cfg = cfgRef.current;
      if (cfg.count === 0) return;
      let v = value;
      if (!cfg.loop) v = Math.min(Math.max(v, 0), Math.max(cfg.count - 1, 0));
      if (snap) v = Math.round(v);
      targetRef.current = v;
      const idx = ((Math.round(v) % cfg.count) + cfg.count) % cfg.count;
      const item = cfg.items[idx];
      if (item === undefined) return;
      if (idx !== selectedRef.current) {
        selectedRef.current = idx;
        setSelectedIndex(idx);
        onChangeRef.current?.(idx, item);
        playTick();
      }
      startLoop();
    },
    [startLoop, playTick],
  );

  // Wheel / touchpad scrolling, registered manually so it can be non-passive.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cfg = cfgRef.current;
      const delta = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY;
      // Cap each event at one step so notchy mouse wheels move exactly one
      // option per click, while touchpads still scroll continuously.
      const step = Math.max(-1, Math.min(1, delta / cfg.rowH));
      applyTarget(targetRef.current + step, false);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(
        () => applyTarget(targetRef.current, true),
        140,
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    };
  }, [applyTarget]);

  const handlePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!cfgRef.current.draggable) return;
    dragRef.current = {
      y: e.clientY,
      start: targetRef.current,
      id: e.pointerId,
    };
    dragMovedRef.current = false;
    setIsDragging(true);
  }, []);

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dy = e.clientY - drag.y;
      if (!dragMovedRef.current && Math.abs(dy) > 4) {
        dragMovedRef.current = true;
        // Capture only once a real drag starts, so plain clicks still reach
        // the items and navigate to them.
        rootRef.current?.setPointerCapture(drag.id);
      }
      if (dragMovedRef.current)
        applyTarget(drag.start - dy / cfgRef.current.rowH, false);
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
      const cfg = cfgRef.current;
      if (index === selectedRef.current) {
        const item = cfg.items[index];
        /* 空态占位可以被滚到中心，但确认动作必须落空，否则会拿 undefined 去开资源。 */
        if (item && !item.disabled) onSelectRef.current?.(index, item);
        return;
      }
      const cur = targetRef.current;
      let d = index - (((cur % cfg.count) + cfg.count) % cfg.count);
      if (cfg.loop && cfg.count > 1) {
        if (d > cfg.count / 2) d -= cfg.count;
        else if (d < -cfg.count / 2) d += cfg.count;
      }
      applyTarget(cur + d, true);
    },
    [applyTarget],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const index = selectedRef.current;
        const item = cfgRef.current.items[index];
        if (item && !item.disabled) onSelectRef.current?.(index, item);
        return;
      }
      let delta: number | null = null;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') delta = -1;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') delta = 1;
      if (delta == null) return;
      e.preventDefault();
      applyTarget(Math.round(targetRef.current) + delta, true);
    },
    [applyTarget],
  );

  useEffect(() => {
    applyTarget(targetRef.current, false);
  }, [
    items,
    fontSize,
    spacing,
    curve,
    tilt,
    blur,
    fade,
    minOpacity,
    side,
    loop,
    smoothing,
    applyTarget,
  ]);

  useEffect(
    () => () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      audioRef.current?.pause();
      if (generatedAudioContextRef.current) {
        void generatedAudioContextRef.current.close();
        generatedAudioContextRef.current = null;
      }
    },
    [],
  );

  return (
    <div
      ref={rootRef}
      role="listbox"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-activedescendant={`${idPrefix}-item-${selectedIndex}`}
      className={`react-bits-option-wheel${side === 'right' ? ' react-bits-option-wheel--right' : ''}${isDragging ? ' react-bits-option-wheel--dragging' : ''}${className ? ` ${className}` : ''}`}
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
      {items.map((item, index) => (
        <div
          id={`${idPrefix}-item-${index}`}
          key={item.id}
          ref={(el) => {
            itemRefs.current[index] = el;
          }}
          role="option"
          aria-selected={selectedIndex === index}
          aria-disabled={item.disabled === true ? true : undefined}
          className={`react-bits-option-wheel__item${selectedIndex === index ? ' react-bits-option-wheel__item--selected' : ''}${item.disabled === true ? ' react-bits-option-wheel__item--disabled' : ''}`}
          onClick={() => handleItemClick(index)}
        >
          <span className="react-bits-option-wheel__label">{item.label}</span>
          {item.secondary ? (
            <span className="react-bits-option-wheel__secondary">
              {item.secondary}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
};

export default OptionWheel;
