'use client';

import { useEffect, useRef } from 'react';
import { Renderer, Program, Mesh, Triangle } from 'ogl';
import { useReducedMotion } from '@/features/workspace/shared/use-reduced-motion';

/**
 * Topography：等高线氛围层（React Bits 适配版，ogl）。
 *
 * 相对原版做的适配：
 * 1. 挂在 `useReducedMotion` 上——reduced-motion 下**根本不建 WebGL**（省 GPU），
 *    与项目对 PixelBlast / PulsingBorder 的「不挂载才真省」约定一致；
 * 2. `pointer-events:none`（见 effects.css），只作为纯装饰不参与命中，也不会把
 *    mousemove 事件铺到画布上；
 * 3. 关闭鼠标交互，默认只做缓慢流动的等高线；
 * 4. 高程三色改为纸/墨紫/朱砂语序（默认低色 accent → 中色 ink-faint → 高色
 *    accent-strong），并压低 opacity，做成「学习地形」的低干扰氛围。
 *
 * 其余 ogl 机制（shader、resize、IntersectionObserver 可视区启停、
 * visibilitychange 停帧）与项目现有 WebGL 层一致地保留。
 */

const hexToRgb = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [
    parseInt(result[1]!, 16) / 255,
    parseInt(result[2]!, 16) / 255,
    parseInt(result[3]!, 16) / 255,
  ];
};

const VERTEX = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uMorphAmount;
uniform float uBands;
uniform float uThickness;
uniform float uScale;
uniform float uPixelSize;
uniform float uGlow;
uniform float uContrast;
uniform float uBrightness;
uniform float uOpacity;
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec2 uMouse;
uniform float uMouseEnabled;
uniform float uMouseRadius;
uniform float uMouseStrength;
uniform float uMouseActive;
uniform float uGrain;
uniform float uGrainIntensity;
uniform vec4 uCtrlA;
uniform vec4 uCtrlB;
uniform vec4 uCtrlC;
uniform vec4 uCtrlD;
out vec4 fragColor;

float bez(float t, vec4 c) {
  float w = 6.2831853 * t;
  return 0.5 * (c.x * sin(w) + c.y * cos(w) + c.z * sin(2.0 * w) + c.w * cos(2.0 * w));
}

float field(vec2 uv) {
  vec2 a = vec2(bez(uv.x, uCtrlA), bez(uv.x, uCtrlB));
  vec2 b = vec2(bez(uv.y, uCtrlC), bez(uv.y, uCtrlD));
  return distance(a, b);
}

vec3 elevationColor(float e) {
  vec3 c = mix(uLow, uMid, smoothstep(0.0, 0.5, e));
  c = mix(c, uHigh, smoothstep(0.5, 1.0, e));
  return c;
}

void main() {
  vec2 res = iResolution.xy;
  vec2 uv = gl_FragCoord.xy / res;
  vec2 suv = (uv - 0.5) / max(uScale, 0.001) + 0.5;
  vec2 sampleUv = suv;
  if (uPixelSize > 1.0) {
    vec2 px = res / uPixelSize;
    sampleUv = (floor(suv * px) + 0.5) / px;
  }
  float fv = field(sampleUv);
  if (uMouseEnabled > 0.5) {
    vec2 d = uv - uMouse;
    d.x *= res.x / max(res.y, 1.0);
    float r = max(uMouseRadius, 0.001);
    float bump = exp(-dot(d, d) / (r * r)) * uMouseStrength * uMouseActive;
    fv += bump;
  }
  float f = fv * uBands;
  float frac = fract(f);
  float lineDist = min(frac, 1.0 - frac);
  float aa = fwidth(f) + 0.0001;
  float mask = 1.0 - smoothstep(uThickness - aa, uThickness + aa, lineDist);
  float glowR = uThickness + uGlow * 0.5 + aa;
  float glow = (1.0 - smoothstep(uThickness, glowR, lineDist)) * step(0.0001, uGlow);
  float elev = clamp(fv / (uMorphAmount * 2.5 + 0.001), 0.0, 1.0);
  vec3 lineCol = elevationColor(elev);
  float coverage = clamp(mask + glow * 0.55, 0.0, 1.0);
  coverage = pow(coverage, max(uContrast, 0.001));
  vec3 outColor = lineCol;
  if (uGrain > 0.5) {
    float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453);
    coverage += (g - 0.5) * uGrainIntensity;
  }
  outColor *= uBrightness;
  outColor = clamp(outColor, 0.0, 1.0);
  float a = clamp(coverage, 0.0, 1.0) * uOpacity;
  fragColor = vec4(outColor * a, a);
}
`;

const CTRL_INDICES = [
  [1, -2, 3, -4],
  [9, -8, 7, -6],
  [5, 2, 5, -5],
  [-1, -3, 8, 9],
];

export function Topography({
  lowColor = '#6a4a86',
  midColor = '#847d6b',
  highColor = '#523368',
  speed = 0.35,
  morphAmount = 3.0,
  morphSpeed = 0.05,
  bands = 2.0,
  thickness = 0.01,
  scale = 1.0,
  pixelSize = 1.0,
  glow = 0.5,
  contrast = 3.0,
  brightness = 1.0,
  opacity = 0.22,
  grain = true,
  grainIntensity = 0.05,
  className = '',
}: {
  lowColor?: string;
  midColor?: string;
  highColor?: string;
  speed?: number;
  morphAmount?: number;
  morphSpeed?: number;
  bands?: number;
  thickness?: number;
  scale?: number;
  pixelSize?: number;
  glow?: number;
  contrast?: number;
  brightness?: number;
  opacity?: number;
  grain?: boolean;
  grainIntensity?: number;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // reduced-motion：不挂载 WebGL，真正省 GPU（与 PixelBlast/PulsingBorder 同策略）。
  useEffect(() => {
    if (reducedMotion) return;
    const container = containerRef.current;
    if (!container) return;

    const renderer = new Renderer({
      webgl: 2,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex: VERTEX,
      fragment: FRAGMENT,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },
        uSpeed: { value: speed },
        uMorphAmount: { value: morphAmount },
        uMorphSpeed: { value: morphSpeed },
        uBands: { value: bands },
        uThickness: { value: thickness },
        uScale: { value: scale },
        uPixelSize: { value: pixelSize },
        uGlow: { value: glow },
        uContrast: { value: contrast },
        uBrightness: { value: brightness },
        uOpacity: { value: opacity },
        uGrain: { value: grain ? 1.0 : 0.0 },
        uGrainIntensity: { value: grainIntensity },
        uLow: { value: new Float32Array(hexToRgb(lowColor)) },
        uMid: { value: new Float32Array(hexToRgb(midColor)) },
        uHigh: { value: new Float32Array(hexToRgb(highColor)) },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uMouseEnabled: { value: 0.0 },
        uMouseRadius: { value: 0.3 },
        uMouseStrength: { value: 0.4 },
        uMouseActive: { value: 0.0 },
        uCtrlA: { value: new Float32Array([0, 0, 0, 0]) },
        uCtrlB: { value: new Float32Array([0, 0, 0, 0]) },
        uCtrlC: { value: new Float32Array([0, 0, 0, 0]) },
        uCtrlD: { value: new Float32Array([0, 0, 0, 0]) },
      },
    });
    const mesh = new Mesh(gl, { geometry, program });

    const setSize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      renderer.setSize(w, h);
      const res = program.uniforms.iResolution.value as Float32Array;
      res[0] = gl.drawingBufferWidth;
      res[1] = gl.drawingBufferHeight;
      renderer.render({ scene: mesh });
    };
    const ro = new ResizeObserver(setSize);
    ro.observe(container);
    setSize();

    const ctrlArrays = [
      program.uniforms.uCtrlA.value as Float32Array,
      program.uniforms.uCtrlB.value as Float32Array,
      program.uniforms.uCtrlC.value as Float32Array,
      program.uniforms.uCtrlD.value as Float32Array,
    ];

    let raf = 0;
    let isVisible = true;
    let isPageVisible = !document.hidden;
    const t0 = performance.now();
    const loop = (t: number) => {
      const time = (t - t0) * 0.001;
      const u = program.uniforms;
      u.iTime.value = time;
      const ma = u.uMorphAmount.value as number;
      const sp = u.uSpeed.value as number;
      const msp = u.uMorphSpeed.value as number;
      for (let g = 0; g < 4; g++) {
        const arr = ctrlArrays[g]!;
        const idx = CTRL_INDICES[g]!;
        for (let j = 0; j < 4; j++) {
          const i = idx[j]!;
          arr[j] = ma * Math.sin(time * sp * Math.sin(i * msp) + i);
        }
      }
      renderer.render({ scene: mesh });
      raf = requestAnimationFrame(loop);
    };
    const tryStart = () => {
      if (isVisible && isPageVisible && raf === 0)
        raf = requestAnimationFrame(loop);
    };
    const tryStop = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        isVisible = entries[0]?.isIntersecting === true;
        if (isVisible) tryStart();
        else tryStop();
      },
      { threshold: 0 },
    );
    io.observe(container);
    const onVisibility = () => {
      isPageVisible = !document.hidden;
      if (isPageVisible) tryStart();
      else tryStop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    tryStart();

    return () => {
      tryStop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      try {
        container.removeChild(canvas);
      } catch {
        // canvas 可能已被卸载
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [
    reducedMotion,
    lowColor,
    midColor,
    highColor,
    speed,
    opacity,
    morphAmount,
    morphSpeed,
    bands,
    thickness,
    scale,
    pixelSize,
    glow,
    contrast,
    brightness,
    grain,
    grainIntensity,
  ]);

  if (reducedMotion) return null;
  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`topography-container ${className}`.trim()}
    />
  );
}

export default Topography;
