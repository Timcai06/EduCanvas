'use client';

import { useId } from 'react';
import { ORB_SHAPES } from './live-voice-motion';

/** 纯视觉液态球；会话状态只通过父级 data-phase 与 GSAP selector 投影。 */
export function LiveVoiceOrb() {
  const instanceId = useId().replaceAll(':', '');
  const bodyGradientId = `live-voice-body-${instanceId}`;
  const warmGradientId = `live-voice-warm-${instanceId}`;
  const coolGradientId = `live-voice-cool-${instanceId}`;
  const glowGradientId = `live-voice-glow-${instanceId}`;
  const glowFilterId = `live-voice-glow-filter-${instanceId}`;
  const bodyClipId = `live-voice-body-clip-${instanceId}`;

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
      </div>
    </div>
  );
}
