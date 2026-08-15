'use client';

import { useEffect, useState } from 'react';
import RippleDistortion from '@/components/RippleDistortion';
import type { LiveVoiceVisualPhase } from './live-voice-motion';

interface LiveVoiceRipplePalette {
  readonly colorA: string;
  readonly colorB: string;
  readonly brightness: number;
  readonly saturation: number;
}

export const LIVE_VOICE_RIPPLE_PALETTES: Record<
  LiveVoiceVisualPhase,
  LiveVoiceRipplePalette
> = {
  idle: {
    colorA: '#725ecf',
    colorB: '#f2a6ea',
    brightness: 0.96,
    saturation: 1.04,
  },
  connecting: {
    colorA: '#5968a9',
    colorB: '#c6d7ff',
    brightness: 0.88,
    saturation: 0.82,
  },
  listening: {
    colorA: '#137fbe',
    colorB: '#6ef0d2',
    brightness: 1.02,
    saturation: 1.12,
  },
  thinking: {
    colorA: '#6540c8',
    colorB: '#e26bc5',
    brightness: 0.94,
    saturation: 1.08,
  },
  speaking: {
    colorA: '#e85d68',
    colorB: '#ffc466',
    brightness: 1.04,
    saturation: 1.14,
  },
  muted: {
    colorA: '#69717d',
    colorB: '#c3c7cc',
    brightness: 0.72,
    saturation: 0.28,
  },
  error: {
    colorA: '#a43d4f',
    colorB: '#ff9a7d',
    brightness: 0.82,
    saturation: 0.9,
  },
};

export function resolveLiveVoiceRippleAppearance(
  phase: LiveVoiceVisualPhase,
  audioLevel: number,
) {
  const palette = LIVE_VOICE_RIPPLE_PALETTES[phase];
  const energy = Math.min(1, Math.max(0, audioLevel));
  const reactive = phase === 'listening' || phase === 'speaking';

  return {
    ...palette,
    brightness: palette.brightness + (reactive ? energy * 0.16 : 0),
    saturation: palette.saturation + (reactive ? energy * 0.2 : 0),
    glint: reactive ? 0.12 + energy * 0.52 : phase === 'thinking' ? 0.14 : 0.06,
    strength: reactive ? 0.14 + energy * 0.08 : 0.13,
  };
}

/** WebGL 只承载相位色场和液态表面；可访问状态仍由 LiveVoiceOrb 的 SVG 提供。 */
export function LiveVoiceRippleOrb({
  phase,
  audioLevel,
}: {
  readonly phase: LiveVoiceVisualPhase;
  readonly audioLevel: number;
}) {
  const [canRenderWebGl, setCanRenderWebGl] = useState(false);
  const appearance = resolveLiveVoiceRippleAppearance(phase, audioLevel);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!('WebGLRenderingContext' in window)) return;
      const canvas = document.createElement('canvas');
      setCanRenderWebGl(Boolean(canvas.getContext('webgl')));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (!canRenderWebGl) return null;

  return (
    <div className="live-voice-ripple-orb" aria-hidden="true">
      <RippleDistortion
        src="/live-voice-ripple-orb.png"
        brushSize={150}
        strength={appearance.strength}
        swirl={1}
        rings={4}
        spread={5}
        fade={3}
        spacing={15}
        dispersion={0}
        glint={appearance.glint}
        grayscale={false}
        tintAmount={0}
        colorA={appearance.colorA}
        colorB={appearance.colorB}
        colorAmount={0.94}
        saturation={appearance.saturation}
        brightness={appearance.brightness}
        colorTransition={phase === 'error' ? 0.18 : 0.42}
        highlightColor="#ffffff"
        trigger="both"
        clickStrength={2}
        quality="low"
        enabled
      />
    </div>
  );
}
