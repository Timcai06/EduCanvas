import type { Effect } from 'postprocessing';
import { Color, Uniform, Vector2, type WebGLRenderer } from 'three';
import {
  PIXEL_BLAST_MAX_CLICKS,
  PIXEL_BLAST_SHAPE_MAP,
} from './pixel-blast-shaders';
import type { PixelBlastRuntimeConfig } from './pixel-blast-types';

export type PixelBlastUniforms = {
  uResolution: Uniform<Vector2>;
  uTime: Uniform<number>;
  uColor: Uniform<Color>;
  uClickPos: Uniform<Vector2[]>;
  uClickTimes: Uniform<Float32Array>;
  uShapeType: Uniform<number>;
  uPixelSize: Uniform<number>;
  uScale: Uniform<number>;
  uDensity: Uniform<number>;
  uPixelJitter: Uniform<number>;
  uEnableRipples: Uniform<number>;
  uRippleSpeed: Uniform<number>;
  uRippleThickness: Uniform<number>;
  uRippleIntensity: Uniform<number>;
  uEdgeFade: Uniform<number>;
};

export function createPixelBlastUniforms(
  config: PixelBlastRuntimeConfig,
  renderer: WebGLRenderer,
): PixelBlastUniforms {
  return {
    uResolution: new Uniform(new Vector2(0, 0)),
    uTime: new Uniform(0),
    uColor: new Uniform(new Color(config.color)),
    uClickPos: new Uniform(
      Array.from({ length: PIXEL_BLAST_MAX_CLICKS }, () => new Vector2(-1, -1)),
    ),
    uClickTimes: new Uniform(new Float32Array(PIXEL_BLAST_MAX_CLICKS)),
    uShapeType: new Uniform(PIXEL_BLAST_SHAPE_MAP[config.variant]),
    uPixelSize: new Uniform(config.pixelSize * renderer.getPixelRatio()),
    uScale: new Uniform(config.patternScale),
    uDensity: new Uniform(config.patternDensity),
    uPixelJitter: new Uniform(config.pixelSizeJitter),
    uEnableRipples: new Uniform(config.enableRipples ? 1 : 0),
    uRippleSpeed: new Uniform(config.rippleSpeed),
    uRippleThickness: new Uniform(config.rippleThickness),
    uRippleIntensity: new Uniform(config.rippleIntensityScale),
    uEdgeFade: new Uniform(config.edgeFade),
  };
}

export function randomPixelBlastTimeOffset() {
  if (window.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    window.crypto.getRandomValues(value);
    return ((value[0] ?? 0) / 0xffffffff) * 1000;
  }
  return Math.random() * 1000;
}

export function setPixelBlastEffectTime(effect: Effect, value: number) {
  const effectWithUniforms = effect as Effect & {
    uniforms: Map<string, Uniform>;
  };
  const uniform = effectWithUniforms.uniforms.get('uTime');
  if (uniform) uniform.value = value;
}
