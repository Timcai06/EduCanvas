import type { CSSProperties } from 'react';

export type PixelBlastVariant = 'square' | 'circle' | 'triangle' | 'diamond';

/** PixelBlast 的公开视觉参数；运行时只消费这些值，不接触业务状态。 */
export type PixelBlastProps = {
  variant?: PixelBlastVariant;
  pixelSize?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
  antialias?: boolean;
  patternScale?: number;
  patternDensity?: number;
  liquid?: boolean;
  liquidStrength?: number;
  liquidRadius?: number;
  pixelSizeJitter?: number;
  enableRipples?: boolean;
  rippleIntensityScale?: number;
  rippleThickness?: number;
  rippleSpeed?: number;
  liquidWobbleSpeed?: number;
  autoPauseOffscreen?: boolean;
  speed?: number;
  transparent?: boolean;
  edgeFade?: number;
  noiseAmount?: number;
};

export type PixelBlastRuntimeConfig = Required<
  Omit<PixelBlastProps, 'className' | 'style'>
>;
