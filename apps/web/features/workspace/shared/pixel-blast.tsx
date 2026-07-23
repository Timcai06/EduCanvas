'use client';

/*
 * PixelBlast —— 移植自 React Bits 固定版本
 * 4cedd620128d36f20b5fcfdee2e27a192f82072f（许可证见 apps/web/THIRD_PARTY_NOTICES.md）。
 * 灵感源 github.com/zavalit/bayer-dithering-webgl-demo。
 * 该入口只负责 React 生命周期；shader、触控纹理和 WebGL 资源分别位于同名前缀模块。
 */

import { useEffect, useEffectEvent, useMemo, useRef } from 'react';
import { PixelBlastRuntime } from './pixel-blast-runtime';
import type {
  PixelBlastProps,
  PixelBlastRuntimeConfig,
} from './pixel-blast-types';

export type { PixelBlastProps } from './pixel-blast-types';

export default function PixelBlast({
  variant = 'square',
  pixelSize = 3,
  color = '#B497CF',
  className,
  style,
  antialias = true,
  patternScale = 2,
  patternDensity = 1,
  liquid = false,
  liquidStrength = 0.1,
  liquidRadius = 1,
  pixelSizeJitter = 0,
  enableRipples = true,
  rippleIntensityScale = 1,
  rippleThickness = 0.1,
  rippleSpeed = 0.3,
  liquidWobbleSpeed = 4.5,
  autoPauseOffscreen = true,
  speed = 0.5,
  transparent = true,
  edgeFade = 0.5,
  noiseAmount = 0,
}: PixelBlastProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<PixelBlastRuntime | null>(null);
  const config = useMemo<PixelBlastRuntimeConfig>(
    () => ({
      antialias,
      autoPauseOffscreen,
      color,
      edgeFade,
      enableRipples,
      liquid,
      liquidRadius,
      liquidStrength,
      liquidWobbleSpeed,
      noiseAmount,
      patternDensity,
      patternScale,
      pixelSize,
      pixelSizeJitter,
      rippleIntensityScale,
      rippleSpeed,
      rippleThickness,
      speed,
      transparent,
      variant,
    }),
    [
      antialias,
      autoPauseOffscreen,
      color,
      edgeFade,
      enableRipples,
      liquid,
      liquidRadius,
      liquidStrength,
      liquidWobbleSpeed,
      noiseAmount,
      patternDensity,
      patternScale,
      pixelSize,
      pixelSizeJitter,
      rippleIntensityScale,
      rippleSpeed,
      rippleThickness,
      speed,
      transparent,
      variant,
    ],
  );
  const createRuntime = useEffectEvent(
    (container: HTMLDivElement) => new PixelBlastRuntime(container, config),
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    delete container.dataset.failed;
    try {
      const runtime = createRuntime(container);
      runtimeRef.current = runtime;
      return () => {
        runtime.dispose();
        if (runtimeRef.current === runtime) runtimeRef.current = null;
      };
    } catch (error) {
      // 装饰层失败必须诚实退场，不能拖垮 Notebook 的核心交互。
      console.warn('PixelBlast WebGL initialization failed', error);
      container.dataset.failed = 'true';
      runtimeRef.current = null;
    }
  }, [antialias, autoPauseOffscreen, liquid, noiseAmount]);

  useEffect(() => {
    runtimeRef.current?.update(config);
  }, [config]);

  return (
    <div
      ref={containerRef}
      className={`pixel-blast-container ${className ?? ''}`}
      style={style}
      aria-hidden="true"
    />
  );
}
