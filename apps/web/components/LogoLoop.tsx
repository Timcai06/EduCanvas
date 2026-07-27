'use client';

import {
  type CSSProperties,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import './LogoLoop.css';

export type LogoItem =
  | { node: ReactNode; title: string; href?: string }
  | {
      src: string;
      alt: string;
      href?: string;
      width?: number;
      height?: number;
    };

export interface LogoLoopProps {
  logos: readonly LogoItem[];
  speed?: number;
  direction?: 'left' | 'right' | 'up' | 'down';
  logoHeight?: number;
  gap?: number;
  hoverSpeed?: number;
  fadeOut?: boolean;
  scaleOnHover?: boolean;
  ariaLabel?: string;
  className?: string;
}

const HEADROOM_COPIES = 2;

/**
 * React Bits LogoLoop 的有界适配：只写 track transform，尺寸变化后重新计算副本；
 * reduced-motion 下不启动 rAF，重复副本始终对读屏隐藏。
 */
export const LogoLoop = memo(function LogoLoop({
  logos,
  speed = 60,
  direction = 'left',
  logoHeight = 24,
  gap = 36,
  hoverSpeed = 12,
  fadeOut = true,
  scaleOnHover = true,
  ariaLabel = 'EduCanvas 技术栈',
  className = '',
}: LogoLoopProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const sequenceRef = useRef<HTMLUListElement>(null);
  const motionRef = useRef({ offset: 0, velocity: 0 });
  const [sequenceSize, setSequenceSize] = useState(0);
  const [copyCount, setCopyCount] = useState(2);
  const [hovered, setHovered] = useState(false);
  const vertical = direction === 'up' || direction === 'down';
  const directionSign = direction === 'left' || direction === 'up' ? 1 : -1;
  const targetVelocity =
    Math.abs(speed) * directionSign * Math.sign(speed || 1);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const sequence = sequenceRef.current;
    if (!container || !sequence) return;
    const rect = sequence.getBoundingClientRect();
    const size = Math.ceil(vertical ? rect.height : rect.width);
    const viewport = vertical ? container.clientHeight : container.clientWidth;
    if (size <= 0) return;
    setSequenceSize(size);
    setCopyCount(Math.max(2, Math.ceil(viewport / size) + HEADROOM_COPIES));
  }, [vertical]);

  useEffect(() => {
    const container = containerRef.current;
    const sequence = sequenceRef.current;
    if (!container || !sequence) return;
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(sequence);
    const images = Array.from(sequence.querySelectorAll('img'));
    images.forEach((image) => {
      image.addEventListener('load', measure);
      image.addEventListener('error', measure);
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      images.forEach((image) => {
        image.removeEventListener('load', measure);
        image.removeEventListener('error', measure);
      });
    };
  }, [logos, measure]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || sequenceSize <= 0) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame: number | null = null;
    let lastTime: number | null = null;

    const renderOffset = () => {
      const offset = motionRef.current.offset;
      track.style.transform = vertical
        ? `translate3d(0, ${-offset}px, 0)`
        : `translate3d(${-offset}px, 0, 0)`;
    };
    const animate = (time: number) => {
      const delta = Math.min(
        0.05,
        Math.max(0, time - (lastTime ?? time)) / 1_000,
      );
      lastTime = time;
      const desired = hovered ? hoverSpeed * directionSign : targetVelocity;
      const smoothing = 1 - Math.exp(-delta / 0.25);
      motionRef.current.velocity +=
        (desired - motionRef.current.velocity) * smoothing;
      motionRef.current.offset =
        (motionRef.current.offset +
          motionRef.current.velocity * delta +
          sequenceSize) %
        sequenceSize;
      renderOffset();
      frame = requestAnimationFrame(animate);
    };
    const syncMotionPreference = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      lastTime = null;
      if (media.matches) {
        motionRef.current.offset = 0;
        motionRef.current.velocity = 0;
        renderOffset();
      } else {
        frame = requestAnimationFrame(animate);
      }
    };
    syncMotionPreference();
    media.addEventListener('change', syncMotionPreference);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      media.removeEventListener('change', syncMotionPreference);
    };
  }, [
    directionSign,
    hoverSpeed,
    hovered,
    sequenceSize,
    targetVelocity,
    vertical,
  ]);

  const variables = {
    '--logoloop-gap': `${gap}px`,
    '--logoloop-height': `${logoHeight}px`,
  } as CSSProperties;
  const copies = useMemo(
    () =>
      Array.from({ length: copyCount }, (_, copyIndex) => (
        <ul
          key={copyIndex}
          ref={copyIndex === 0 ? sequenceRef : undefined}
          className="logo-loop__list"
          aria-hidden={copyIndex > 0}
        >
          {logos.map((logo, logoIndex) => (
            <LogoLoopItem
              key={`${copyIndex}-${logoIndex}`}
              item={logo}
              hidden={copyIndex > 0}
            />
          ))}
        </ul>
      )),
    [copyCount, logos],
  );

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={ariaLabel}
      style={variables}
      className={`logo-loop${vertical ? ' logo-loop--vertical' : ''}${fadeOut ? ' logo-loop--fade' : ''}${scaleOnHover ? ' logo-loop--scale-hover' : ''}${className ? ` ${className}` : ''}`}
    >
      <div
        ref={trackRef}
        className="logo-loop__track"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {copies}
      </div>
    </div>
  );
});

function LogoLoopItem({ item, hidden }: { item: LogoItem; hidden: boolean }) {
  const content =
    'node' in item ? (
      <span className="logo-loop__node">{item.node}</span>
    ) : (
      // LogoLoop 接受受信任的品牌静态图；调用方负责提供稳定尺寸，避免布局跳动。
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.src}
        alt={hidden ? '' : item.alt}
        width={item.width}
        height={item.height}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    );
  return (
    <li className="logo-loop__item">
      {item.href ? (
        <a
          className="logo-loop__link"
          href={item.href}
          aria-label={
            hidden ? undefined : 'node' in item ? item.title : item.alt
          }
          tabIndex={hidden ? -1 : undefined}
          target="_blank"
          rel="noreferrer noopener"
        >
          {content}
        </a>
      ) : (
        content
      )}
    </li>
  );
}
