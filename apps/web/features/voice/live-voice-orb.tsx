'use client';

import { useId } from 'react';
import { ORB_SHAPES } from './live-voice-motion';

/** 纯视觉液态球；会话状态只通过父级 data-phase 与 GSAP selector 投影。 */
export function LiveVoiceOrb() {
  const clipId = `live-voice-clip-${useId().replaceAll(':', '')}`;
  const glowId = `live-voice-glow-${useId().replaceAll(':', '')}`;
  const liquidId = `live-voice-liquid-${useId().replaceAll(':', '')}`;
  const auraGradientId = `live-voice-aura-${useId().replaceAll(':', '')}`;

  return (
    <div data-live-orb-wrap className="live-voice-orb-wrap">
      <div data-live-orb-reactive className="live-voice-orb-reactive">
        <div
          data-live-aura-shell
          aria-hidden="true"
          className="live-voice-orb-aura-shell"
        >
          <i data-live-aura-layer="a" />
          <i data-live-aura-layer="b" />
          <i data-live-aura-layer="c" />
        </div>
        <svg
          data-live-orb
          viewBox="0 0 200 200"
          role="img"
          aria-label="Live Voice 声音状态"
          className="live-voice-orb"
        >
          <defs>
            <clipPath id={clipId}>
              <path data-live-morph d={ORB_SHAPES.calm} />
            </clipPath>
            <filter id={glowId} x="-70%" y="-70%" width="240%" height="240%">
              <feGaussianBlur stdDeviation="12" />
            </filter>
            <filter
              id={liquidId}
              x="-120%"
              y="-120%"
              width="340%"
              height="340%"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.012 0.018"
                numOctaves="2"
                seed="7"
                result="noise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale="16"
                xChannelSelector="R"
                yChannelSelector="B"
                result="displaced"
              />
              <feGaussianBlur in="displaced" stdDeviation="5.5" />
            </filter>
            <linearGradient
              id={`${clipId}-base`}
              x1="30"
              y1="25"
              x2="170"
              y2="175"
            >
              <stop offset="0" stopColor="var(--color-card)" />
              <stop offset="0.52" stopColor="currentColor" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0.72" />
            </linearGradient>
            <radialGradient id={auraGradientId} cx="42%" cy="38%" r="68%">
              <stop
                offset="0"
                stopColor="var(--color-card)"
                stopOpacity="0.42"
              />
              <stop offset="0.38" stopColor="currentColor" stopOpacity="0.3" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
          </defs>

          <g
            data-live-aura-reactive
            className="live-voice-svg-aura"
            aria-hidden="true"
          >
            <path
              data-live-morph
              data-live-aura="outer"
              d={ORB_SHAPES.calm}
              fill={`url(#${auraGradientId})`}
              filter={`url(#${liquidId})`}
            />
            <path
              data-live-morph
              data-live-aura="middle"
              d={ORB_SHAPES.calm}
              fill="none"
              stroke="currentColor"
            />
            <path
              data-live-morph
              data-live-aura="inner"
              d={ORB_SHAPES.calm}
              fill="currentColor"
              filter={`url(#${glowId})`}
            />
          </g>

          <path
            data-live-morph
            data-live-orb-energy
            d={ORB_SHAPES.calm}
            fill="currentColor"
            opacity="0.32"
            filter={`url(#${glowId})`}
          />
          <g data-live-rings className="live-voice-rings" aria-hidden="true">
            <circle data-live-ring cx="100" cy="100" r="58" />
            <circle data-live-ring cx="100" cy="100" r="58" />
            <circle data-live-ring cx="100" cy="100" r="58" />
            <circle data-live-ring cx="100" cy="100" r="58" />
          </g>
          <g
            data-live-particle-orbit
            className="live-voice-particle-orbit"
            aria-hidden="true"
          >
            <circle data-live-particle cx="100" cy="9" r="1.8" />
            <circle data-live-particle cx="169" cy="42" r="1.15" />
            <circle data-live-particle cx="184" cy="130" r="1.45" />
            <circle data-live-particle cx="49" cy="176" r="1.05" />
            <circle data-live-particle cx="18" cy="73" r="1.35" />
          </g>
          <g clipPath={`url(#${clipId})`}>
            <rect width="200" height="200" fill={`url(#${clipId}-base)`} />
            <ellipse
              data-live-light="a"
              cx="72"
              cy="62"
              rx="66"
              ry="49"
              fill="var(--color-card)"
              opacity="0.82"
              filter={`url(#${glowId})`}
            />
            <ellipse
              data-live-light="b"
              cx="142"
              cy="126"
              rx="62"
              ry="54"
              fill="currentColor"
              opacity="0.74"
              filter={`url(#${glowId})`}
            />
            <ellipse
              data-live-light="c"
              cx="96"
              cy="112"
              rx="29"
              ry="25"
              fill="var(--color-card)"
              opacity="0.78"
              filter={`url(#${glowId})`}
            />
          </g>
          <path
            data-live-morph
            d={ORB_SHAPES.calm}
            fill="none"
            stroke="var(--color-card)"
            strokeOpacity="0.42"
            strokeWidth="1.2"
          />
          <path
            data-live-sheen
            d="M62 64C78 46 111 39 137 55"
            fill="none"
            stroke="var(--color-card)"
            strokeLinecap="round"
            strokeOpacity="0.72"
            strokeWidth="2.4"
          />
        </svg>
      </div>
    </div>
  );
}
