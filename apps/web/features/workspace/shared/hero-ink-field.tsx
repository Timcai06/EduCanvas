'use client';

import dynamic from 'next/dynamic';
import { useCssVarColor } from './use-css-var-color';
import { useReducedMotion } from './use-reduced-motion';

/*
 * 扉页「墨点场」：落地页背景的一层可交互网点（PixelBlast / WebGL / three）。
 * 单色黛青、极低透明，纯材质暗示——鼠标划过墨点微微流动、点击起涟漪，
 * 但绝不承载信息，也不拦截交互（aria-hidden，容器 pointer-events 由 PixelBlast 自管）。
 *
 * three 体量大，故 `ssr:false` 懒加载、只在落地页挂载；减少动态偏好下直接不挂载，
 * 由 CSS 兜底的静态纸面接管（见 effects.css .hero-ink-field）。
 */
const PixelBlast = dynamic(() => import('./pixel-blast'), { ssr: false });

export function HeroInkField() {
  const reduced = useReducedMotion();
  // 专用点色而非 --color-accent：亮色需喂更深的黛青墨抵消 shader 的提亮，见 globals.css
  const ink = useCssVarColor('--hero-ink-dot', '#0e343d');

  if (reduced) return null;

  return (
    <div className="hero-ink-field" aria-hidden="true">
      <PixelBlast
        variant="circle"
        pixelSize={6}
        color={ink}
        patternScale={3}
        patternDensity={1.4}
        pixelSizeJitter={0.4}
        enableRipples
        rippleSpeed={0.35}
        rippleThickness={0.1}
        rippleIntensityScale={1.3}
        liquid
        liquidStrength={0.09}
        liquidRadius={1.1}
        liquidWobbleSpeed={4.5}
        speed={0.45}
        edgeFade={0.12}
        transparent
      />
    </div>
  );
}
