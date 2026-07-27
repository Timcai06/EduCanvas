'use client';

import { useEffect, useRef } from 'react';
import { subscribeInkSplash, type SplashOrigin } from './ink-splash';

/**
 * 泼墨庆祝宿主（对 SplashCursor 的「一次性、墨色、正确生命周期」改造版）。
 * 挂在根布局，订阅 celebrate() 后在全屏画布上迸发一团墨紫/朱砂的墨，约 1.7 秒后自行清空。
 *
 * 与原版的关键差异（守项目动效规范）：
 * - 一次性、不常驻：平时画布是空的、pointer-events:none，不跑 rAF；只在触发时短暂动画；
 * - reduced-motion / 页面隐藏 时直接不绘制，不建动态上下文；
 * - 卸载时取消 rAF、清监听，无泄漏；取色走 --color-accent / --color-cinnabar 令牌，跟随主题；
 * - 用 Canvas 2D 的软径向渐变叠出「墨在纸上化开」的感觉，而非常驻 WebGL 流体。
 */
const DURATION = 1700;
const PARTICLES = 18;

interface Blob {
  angle: number;
  dist: number;
  size: number;
  delay: number;
  color: string;
}

function hexToRgba(hex: string, alpha: number): string {
  let value = hex.trim().replace('#', '');
  if (value.length === 3) {
    value =
      value[0]! + value[0]! + value[1]! + value[1]! + value[2]! + value[2]!;
  }
  const r = parseInt(value.slice(0, 2), 16) || 0;
  const g = parseInt(value.slice(2, 4), 16) || 0;
  const b = parseInt(value.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function InkSplashHost() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const run = (origin: SplashOrigin) => {
      if (
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        document.hidden
      ) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      canvas.width = Math.floor(vw * dpr);
      canvas.height = Math.floor(vh * dpr);
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;

      const root = getComputedStyle(document.documentElement);
      const accent = root.getPropertyValue('--color-accent') || '#6a4a86';
      const cinnabar = root.getPropertyValue('--color-cinnabar') || '#cf4429';
      const maxDist = Math.min(vw, vh) * 0.3;
      const ox = origin.x * dpr;
      const oy = origin.y * dpr;

      const blobs: Blob[] = Array.from({ length: PARTICLES }, () => ({
        angle: Math.random() * Math.PI * 2,
        dist: (0.25 + Math.random() * 0.75) * maxDist * dpr,
        size: (14 + Math.random() * 34) * dpr,
        delay: Math.random() * 0.16,
        color: Math.random() < 0.72 ? accent : cinnabar,
      }));
      // 中心主墨
      blobs.push({
        angle: 0,
        dist: 0,
        size: 64 * dpr,
        delay: 0,
        color: accent,
      });

      const start = performance.now();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);

      const frame = (now: number) => {
        const p = (now - start) / DURATION;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (p >= 1) {
          rafRef.current = null;
          return;
        }
        for (const blob of blobs) {
          const local = (p - blob.delay) / (1 - blob.delay);
          if (local <= 0) continue;
          const t = Math.min(1, local);
          const ease = 1 - Math.pow(1 - t, 3); // out-cubic
          const radius = ease * blob.size + blob.size * 0.4;
          const cx = ox + Math.cos(blob.angle) * ease * blob.dist;
          const cy = oy + Math.sin(blob.angle) * ease * blob.dist;
          // 快进慢出：先化开、再洇淡
          const alpha = (t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75) * 0.5;
          const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
          gradient.addColorStop(0, hexToRgba(blob.color, alpha));
          gradient.addColorStop(0.55, hexToRgba(blob.color, alpha * 0.5));
          gradient.addColorStop(1, hexToRgba(blob.color, 0));
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        rafRef.current = requestAnimationFrame(frame);
      };
      rafRef.current = requestAnimationFrame(frame);
    };

    const unsubscribe = subscribeInkSplash(run);
    return () => {
      unsubscribe();
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[70]"
    />
  );
}
