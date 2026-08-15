'use client';

import { useId, type CSSProperties } from 'react';
import { ORB_SHAPES } from './live-voice-motion';
import type { LiveVoiceVisualPhase } from './live-voice-motion';
import { LiveVoiceRippleOrb } from './live-voice-ripple-orb';

/** 纯视觉液态球；相位同时投影到 SVG 轮廓、WebGL 色场与 GSAP 动势。 */
export function LiveVoiceOrb({
  phase,
  audioLevel,
}: {
  readonly phase: LiveVoiceVisualPhase;
  readonly audioLevel: number;
}) {
  const instanceId = useId().replaceAll(':', '');
  const bodyGradientId = `live-voice-body-${instanceId}`;
  const warmGradientId = `live-voice-warm-${instanceId}`;
  const coolGradientId = `live-voice-cool-${instanceId}`;
  const glowGradientId = `live-voice-glow-${instanceId}`;
  const glowFilterId = `live-voice-glow-filter-${instanceId}`;
  const bodyClipId = `live-voice-body-clip-${instanceId}`;
  const voiceActive = phase === 'listening' || phase === 'speaking';
  const voiceEnergy = Math.min(1, Math.max(0, audioLevel));

  return (
    <div
      data-live-orb-wrap
      data-voice-active={voiceActive ? 'true' : 'false'}
      data-voice-speaker={phase === 'speaking' ? 'agent' : 'user'}
      className="live-voice-orb-wrap"
      style={
        {
          '--live-voice-wave-glow': `${1.1 + voiceEnergy * 1.8}rem`,
          '--live-voice-wave-opacity-start': 0.2 + voiceEnergy * 0.24,
          '--live-voice-wave-opacity-mid': 0.1 + voiceEnergy * 0.14,
          '--live-voice-wave-scale-start': 0.9 + voiceEnergy * 0.035,
          '--live-voice-wave-scale-end': 1.14 + voiceEnergy * 0.13,
        } as CSSProperties
      }
    >
      <div data-live-orb-reactive className="live-voice-orb-reactive">
        <div className="live-voice-orb-waves" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <svg
          data-live-orb
          viewBox="0 0 200 200"
          role="img"
          aria-label="Live Voice 声音状态"
          className="live-voice-orb"
        >
          <defs>
            <radialGradient
              id={bodyGradientId}
              gradientUnits="userSpaceOnUse"
              cx="70"
              cy="58"
              r="118"
              fx="58"
              fy="46"
            >
              <stop
                offset="0"
                stopColor="var(--live-orb-light)"
                stopOpacity="0.98"
              />
              <stop
                offset="0.2"
                stopColor="var(--live-orb-soft)"
                stopOpacity="0.96"
              />
              <stop
                offset="0.56"
                stopColor="var(--live-voice-accent)"
                stopOpacity="0.98"
              />
              <stop
                offset="1"
                stopColor="var(--live-orb-deep)"
                stopOpacity="0.96"
              />
            </radialGradient>
            <radialGradient id={warmGradientId} cx="50%" cy="50%" r="50%">
              <stop
                offset="0"
                stopColor="var(--live-orb-warm)"
                stopOpacity="0.94"
              />
              <stop
                offset="0.62"
                stopColor="var(--live-orb-warm)"
                stopOpacity="0.36"
              />
              <stop
                offset="1"
                stopColor="var(--live-orb-warm)"
                stopOpacity="0"
              />
            </radialGradient>
            <radialGradient id={coolGradientId} cx="50%" cy="50%" r="50%">
              <stop
                offset="0"
                stopColor="var(--live-orb-cool)"
                stopOpacity="0.92"
              />
              <stop
                offset="0.58"
                stopColor="var(--live-orb-cool)"
                stopOpacity="0.3"
              />
              <stop
                offset="1"
                stopColor="var(--live-orb-cool)"
                stopOpacity="0"
              />
            </radialGradient>
            <radialGradient id={glowGradientId} cx="50%" cy="50%" r="50%">
              <stop
                offset="0"
                stopColor="var(--live-voice-accent)"
                stopOpacity="0.54"
              />
              <stop
                offset="0.5"
                stopColor="var(--live-voice-accent)"
                stopOpacity="0.24"
              />
              <stop
                offset="1"
                stopColor="var(--live-voice-accent)"
                stopOpacity="0"
              />
            </radialGradient>
            <filter
              id={glowFilterId}
              x="-55%"
              y="-55%"
              width="210%"
              height="210%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation="15" />
            </filter>
            <clipPath id={bodyClipId} clipPathUnits="userSpaceOnUse">
              <path data-live-morph d={ORB_SHAPES.calm} />
            </clipPath>
          </defs>
          <circle
            data-live-glow
            aria-hidden="true"
            cx="100"
            cy="100"
            r="86"
            fill={`url(#${glowGradientId})`}
            filter={`url(#${glowFilterId})`}
          />
          <g
            data-live-orb-body
            clipPath={`url(#${bodyClipId})`}
            className="live-voice-orb-body"
          >
            <rect
              x="28"
              y="28"
              width="144"
              height="144"
              fill={`url(#${bodyGradientId})`}
            />
            <circle
              data-live-flow-a
              className="live-voice-flow-layer"
              cx="61"
              cy="66"
              r="72"
              fill={`url(#${warmGradientId})`}
            />
            <circle
              data-live-flow-b
              className="live-voice-flow-layer"
              cx="143"
              cy="137"
              r="82"
              fill={`url(#${coolGradientId})`}
            />
          </g>
        </svg>
        <LiveVoiceRippleOrb phase={phase} audioLevel={audioLevel} />
      </div>
    </div>
  );
}
