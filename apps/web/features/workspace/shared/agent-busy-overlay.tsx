'use client';

import dynamic from 'next/dynamic';
import {
  Component,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { useCssVarColor } from './use-css-var-color';
import { useReducedMotion } from './use-reduced-motion';

/*
 * Agent 工作态全屏氛围层：老师「落笔」思考到给出回复期间，视口四周浮起一圈
 * 呼吸流光（学 ego/Arc 的 agent 操作态语义——「此刻是 AI 的回合」），
 * 但配色走墨色（黛青为主、朱砂点睛），是我们自己的水墨而非彩虹霓虹。
 *
 * PulsingBorder 是边缘富集、中心透明的 shader（正好是「边框光」分布），pointer-events:none
 * 不挡交互。为省电：仅在 busy 时挂载 WebGL，退场淡出后卸载释放上下文；减少动态偏好下
 * 换成不流动的静态 CSS 柔光边（见 effects.css .agent-busy-fallback）。
 */
const PulsingBorder = dynamic(
  () => import('./pixel-blast-pulsing-border-adapter'),
  { ssr: false },
);

const FADE_MS = 520;
let webGl2Available: boolean | null = null;

function supportsWebGl2() {
  if (webGl2Available !== null) return webGl2Available;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    webGl2Available = context !== null;
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch (error) {
    console.warn('Agent busy shader WebGL probe failed', error);
    webGl2Available = false;
  }
  return webGl2Available;
}

function subscribeDocumentVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function getDocumentVisible() {
  return !document.hidden;
}

function getServerDocumentVisible() {
  return false;
}

class BusyShaderBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Agent busy shader failed', error, info.componentStack);
  }

  render() {
    if (this.state.failed) return <div className="agent-busy-fallback" />;
    return this.props.children;
  }
}

export function AgentBusyOverlay({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const documentVisible = useSyncExternalStore(
    subscribeDocumentVisibility,
    getDocumentVisible,
    getServerDocumentVisible,
  );
  const accent = useCssVarColor('--color-accent', '#31606c');
  const accentStrong = useCssVarColor('--color-accent-strong', '#234c58');
  const cinnabar = useCssVarColor('--color-cinnabar', '#bf4029');

  /* 挂载晚于 active、卸载晚于 !active：退场先淡出再释放 WebGL 上下文。
     状态更新全部推到 rAF/timeout 异步回调里——既满足「effect 内不同步 setState」，
     也天然给出「先挂载、下一帧再点亮」的一帧间隔，让 CSS 透明度过渡真正触发。 */
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    let rafShow = 0;
    const rafMount = requestAnimationFrame(() => {
      if (active) {
        setMounted(true);
        rafShow = requestAnimationFrame(() => setShown(true));
      } else {
        setShown(false);
        timerRef.current = window.setTimeout(() => setMounted(false), FADE_MS);
      }
    });
    return () => {
      cancelAnimationFrame(rafMount);
      cancelAnimationFrame(rafShow);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [active]);

  if (!mounted) return null;
  const canRenderShader = documentVisible && !reduced && supportsWebGl2();

  return (
    <div
      aria-hidden="true"
      className="agent-busy-overlay"
      data-shown={shown ? 'true' : 'false'}
    >
      {!canRenderShader ? (
        <div className="agent-busy-fallback" />
      ) : (
        <BusyShaderBoundary>
          <PulsingBorder
            style={{ width: '100%', height: '100%' }}
            colors={[accent, accentStrong, accent, cinnabar]}
            colorBack="rgba(0,0,0,0)"
            roundness={0}
            thickness={0.06}
            softness={1}
            intensity={0.28}
            bloom={0.55}
            spots={4}
            spotSize={0.32}
            pulse={0.18}
            smoke={0.42}
            smokeSize={0.72}
            speed={0.9}
            scale={1}
          />
        </BusyShaderBoundary>
      )}
    </div>
  );
}
