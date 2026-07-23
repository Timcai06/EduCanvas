'use client';

import dynamic from 'next/dynamic';
import { useCssVarColor } from './use-css-var-color';
import { useReducedMotion } from './use-reduced-motion';

/*
 * 扉页「墨点场」：落地页背景的一层安静网点（PixelBlast / WebGL / three）。
 * 单色黛青、极低透明，只作纯材质暗示——极缓自漂移，**不响应鼠标**：关掉了液态跟随与
 * 点击涟漪，向 Gemini/NotebookLM 那种沉静背景看齐，避免喧宾夺主、也顺带消除侧栏展开时
 * EffectComposer render target 缩放导致的闪烁（无 liquid/noise 时不建 composer，走朴素 renderer）。
 * aria-hidden、不承载信息、不拦截交互（pointer-events:none）。
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
      {/* 安静场：关 liquid/ripples（默认 ripples 为开，必须显式关），只留极缓自漂移 */}
      <PixelBlast
        variant="circle"
        pixelSize={6}
        color={ink}
        patternScale={3}
        patternDensity={1.4}
        pixelSizeJitter={0.4}
        enableRipples={false}
        liquid={false}
        speed={0.35}
        edgeFade={0.12}
        transparent
      />
    </div>
  );
}
