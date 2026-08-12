'use client';

import { useId } from 'react';
import { ORB_SHAPES } from './live-voice-motion';

/** 纯视觉液态球；会话状态只通过父级 data-phase 与 GSAP selector 投影。 */
export function LiveVoiceOrb() {
  const instanceId = useId().replaceAll(':', '');
  const bodyGradientId = `live-voice-body-${instanceId}`;
  const glowGradientId = `live-voice-glow-${instanceId}`;

  return (
    <div data-live-orb-wrap className="live-voice-orb-wrap">
      <div data-live-orb-reactive className="live-voice-orb-reactive">
        <svg
          data-live-orb
          viewBox="0 0 200 200"
          role="img"
          aria-label="Live Voice 声音状态"
          className="live-voice-orb"
        >
          <defs>
            <linearGradient
              id={bodyGradientId}
              gradientUnits="userSpaceOnUse"
              x1="30"
              y1="25"
              x2="170"
              y2="175"
            >
              <stop
                offset="0"
                stopColor="var(--color-card)"
                stopOpacity="0.96"
              />
              <stop
                offset="0.38"
                stopColor="var(--live-voice-accent)"
                stopOpacity="0.98"
              />
              <stop
                offset="1"
                stopColor="var(--color-accent-strong)"
                stopOpacity="0.9"
              />
            </linearGradient>
            <radialGradient id={glowGradientId} cx="50%" cy="50%" r="50%">
              <stop
                offset="0"
                stopColor="var(--live-voice-accent)"
                stopOpacity="0.5"
              />
              <stop
                offset="0.58"
                stopColor="var(--live-voice-accent)"
                stopOpacity="0.18"
              />
              <stop
                offset="1"
                stopColor="var(--live-voice-accent)"
                stopOpacity="0"
              />
            </radialGradient>
          </defs>
          <circle
            data-live-glow
            aria-hidden="true"
            cx="100"
            cy="100"
            r="98"
            fill={`url(#${glowGradientId})`}
          />
          <path
            data-live-morph
            d={ORB_SHAPES.calm}
            fill={`url(#${bodyGradientId})`}
            stroke="var(--color-accent-strong)"
            strokeOpacity="0.68"
            strokeWidth="1.25"
          />
          <ellipse
            cx="78"
            cy="68"
            rx="30"
            ry="18"
            fill="var(--color-card)"
            opacity="0.22"
          />
        </svg>
      </div>
    </div>
  );
}
