import type { CSSProperties } from 'react';
import { Renderer, Texture } from 'ogl';

export const MAX_WAVES = 100;
export const QUALITY_SCALE: Record<string, number> = {
  low: 0.4,
  medium: 0.7,
  high: 1,
};
export const START_SCALE = 1.5;
export const LIFE_CONSTANT = Math.log(500);

export function createRippleRenderer(mount: HTMLDivElement) {
  const renderer = new Renderer({
    alpha: false,
    antialias: false,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 1);
  const canvas = gl.canvas;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  mount.appendChild(canvas);
  const imageTexture = new Texture(gl, {
    generateMipmaps: false,
    minFilter: gl.LINEAR,
    magFilter: gl.LINEAR,
    wrapS: gl.CLAMP_TO_EDGE,
    wrapT: gl.CLAMP_TO_EDGE,
  });
  return { renderer, gl, canvas, imageTexture };
}

export function loadRippleImage(
  src: string,
  texture: Texture,
  onSize: (width: number, height: number) => void,
): () => void {
  let disposed = false;
  const image = new window.Image();
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';
  image.onload = () => {
    if (disposed) return;
    texture.image = image;
    onSize(image.naturalWidth || 1, image.naturalHeight || 1);
  };
  image.src = src;
  return () => {
    disposed = true;
  };
}

export function getRippleLocalPoint(
  mount: HTMLDivElement,
  clientX: number,
  clientY: number,
): [number, number] | null {
  const rect = mount.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return null;
  }
  return [clientX - rect.left, rect.height - (clientY - rect.top)];
}

export const waveVertex = `
precision highp float;

attribute vec2 position;
attribute vec2 uv;
attribute vec2 iOffset;
attribute vec2 iScale;
attribute float iOpacity;

varying vec2 vUv;
varying float vOpacity;

void main() {
  vUv = uv;
  vOpacity = iOpacity;
  gl_Position = vec4(iOffset + position * iScale, 0.0, 1.0);
}
`;

export const waveFragment = `
precision highp float;

varying vec2 vUv;
varying float vOpacity;

uniform float uRings;

const float PI = 3.141592653589793;
const float EDGE = 0.006737947;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;

  float brush = (exp(-r * 5.0) - EDGE) / (1.0 - EDGE);

  brush *= 0.55 + 0.45 * cos(sqrt(r) * PI * 2.0 * uRings);

  gl_FragColor = vec4(vec3(brush * vOpacity * vOpacity), 1.0);
}
`;

export const screenVertex = `
precision highp float;
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const compositeFragment = `
precision highp float;

varying vec2 vUv;

uniform sampler2D uTexture;
uniform sampler2D uDisplacement;
uniform vec2 uResolution;
uniform vec2 uTextureSize;
uniform vec2 uTexel;
uniform vec3 uTint;
uniform vec3 uHighlight;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uStrength;
uniform float uSwirl;
uniform float uDispersion;
uniform float uGlint;
uniform float uTintAmount;
uniform float uGrayscale;
uniform float uColorAmount;
uniform float uSaturation;
uniform float uBrightness;

const float TAU = 6.283185307179586;

vec2 coverUV(vec2 uv) {
  vec2 safe = max(uTextureSize, vec2(1.0));
  vec2 s = uResolution / safe;
  vec2 scaledSize = safe * max(s.x, s.y);
  vec2 offset = (uResolution - scaledSize) * 0.5;
  return (uv * uResolution - offset) / scaledSize;
}

void main() {
  float amount = texture2D(uDisplacement, vUv).r;
  vec2 base = coverUV(vUv);

  float theta = amount * uSwirl * TAU;
  vec2 dir = vec2(sin(theta), cos(theta));
  vec2 push = dir * amount * uStrength;

  vec3 color;
  if (uDispersion > 0.001) {
    float split = uDispersion * 0.25;
    color.r = texture2D(uTexture, base + push * (1.0 + split)).r;
    color.g = texture2D(uTexture, base + push).g;
    color.b = texture2D(uTexture, base + push * (1.0 - split)).b;
  } else {
    color = texture2D(uTexture, base + push).rgb;
  }

  if (uGrayscale > 0.001) {
    color = mix(color, vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), uGrayscale);
  }

  if (uColorAmount > 0.001) {
    float sourceLight = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float field = clamp(0.5 + (base.x - base.y) * 0.58 + (sourceLight - 0.5) * 0.42, 0.0, 1.0);
    vec3 palette = mix(uColorA, uColorB, smoothstep(0.0, 1.0, field));
    color = mix(color, palette, clamp(uColorAmount, 0.0, 1.0));
  }

  float gradedLight = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(gradedLight), color, max(uSaturation, 0.0)) * max(uBrightness, 0.0);

  if (uTintAmount > 0.001) {
    color = mix(color, color * uTint * 1.9, clamp(amount * 1.6, 0.0, 1.0) * uTintAmount);
  }

  if (uGlint > 0.001) {
    float ex = texture2D(uDisplacement, vUv + vec2(uTexel.x, 0.0)).r - texture2D(uDisplacement, vUv - vec2(uTexel.x, 0.0)).r;
    float ey = texture2D(uDisplacement, vUv + vec2(0.0, uTexel.y)).r - texture2D(uDisplacement, vUv - vec2(0.0, uTexel.y)).r;
    vec3 normal = normalize(vec3(-ex * 26.0, -ey * 26.0, 1.0));
    vec3 light = normalize(vec3(-0.35, 0.55, 1.0));
    float raw = pow(max(dot(normal, light), 0.0), 22.0);
    float flatSpec = pow(max(light.z, 0.0), 22.0);
    color += uHighlight * clamp((raw - flatSpec) / max(1.0 - flatSpec, 0.0001), 0.0, 1.0) * uGlint;
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

type RippleTrigger = 'hover' | 'click' | 'both';
type RippleQuality = 'low' | 'medium' | 'high';

export interface RippleDistortionProps {
  src?: string;
  brushSize?: number;
  strength?: number;
  swirl?: number;
  rings?: number;
  spread?: number;
  fade?: number;
  spacing?: number;
  dispersion?: number;
  glint?: number;
  tint?: string;
  tintAmount?: number;
  grayscale?: boolean;
  colorA?: string;
  colorB?: string;
  colorAmount?: number;
  saturation?: number;
  brightness?: number;
  colorTransition?: number;
  highlightColor?: string;
  trigger?: RippleTrigger;
  clickStrength?: number;
  quality?: RippleQuality;
  enabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

export interface WaveConfig {
  brushSize: number;
  spread: number;
  fade: number;
  spacing: number;
  clickStrength: number;
  trigger: RippleTrigger;
  enabled: boolean;
}

export interface Wave {
  x: number;
  y: number;
  scale: number;
  target: number;
  size: number;
  opacity: number;
}

export interface CompositeUniforms {
  uTexture: { value: Texture };
  uDisplacement: { value: Texture };
  uResolution: { value: [number, number] };
  uTextureSize: { value: [number, number] };
  uTexel: { value: [number, number] };
  uTint: { value: [number, number, number] };
  uHighlight: { value: [number, number, number] };
  uColorA: { value: [number, number, number] };
  uColorB: { value: [number, number, number] };
  uStrength: { value: number };
  uSwirl: { value: number };
  uDispersion: { value: number };
  uGlint: { value: number };
  uTintAmount: { value: number };
  uGrayscale: { value: number };
  uColorAmount: { value: number };
  uSaturation: { value: number };
  uBrightness: { value: number };
  [key: string]: { value: unknown };
}

export interface WaveUniforms {
  uRings: { value: number };
  [key: string]: { value: unknown };
}

export interface RippleUniforms {
  wave: WaveUniforms;
  composite: CompositeUniforms;
}

export interface ColorTarget {
  colorA: [number, number, number];
  colorB: [number, number, number];
  amount: number;
  saturation: number;
  brightness: number;
  transition: number;
}

export const hexToRGB = (hex: string): [number, number, number] => {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const approachColor = (
  current: [number, number, number],
  target: [number, number, number],
  amount: number,
) => {
  current[0] += (target[0] - current[0]) * amount;
  current[1] += (target[1] - current[1]) * amount;
  current[2] += (target[2] - current[2]) * amount;
};
