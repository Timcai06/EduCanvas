'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef } from 'react';

gsap.registerPlugin(useGSAP);

/** Composer 通过 window 事件与光场对话,避免跨组件 prop 钻孔。 */
export const COMPOSER_FOCUS_EVENT = 'educanvas:composer-focus';
export const COMPOSER_SEND_EVENT = 'educanvas:composer-send';

/**
 * S0 的环境光场。模糊和渐变留在静态子层，GSAP 只改变外层 wrapper 的
 * transform/opacity，避免呼吸动效逐帧重绘大面积 filter。
 * 输入框 focus/发送的呼应只作用于根容器,与作用于子层的呼吸 Timeline 无属性冲突。
 */
export function AmbientHalo() {
  const rootRef = useRef<HTMLDivElement>(null);
  const hazeRef = useRef<HTMLDivElement>(null);
  const bloomRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);

  useGSAP(
    (_, contextSafe) => {
      const root = rootRef.current;
      const haze = hazeRef.current;
      const bloom = bloomRef.current;
      const core = coreRef.current;
      if (!root || !haze || !bloom || !core || !contextSafe) return;

      const reduceMotionQuery = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      );
      const scaleTo = gsap.quickTo(root, 'scale', {
        duration: 0.7,
        ease: 'power2.out',
      });
      const onComposerFocus = contextSafe((event: Event) => {
        if (reduceMotionQuery.matches) return;
        const focused = (event as CustomEvent<{ focused: boolean }>).detail
          ?.focused;
        scaleTo(focused ? 1.045 : 1);
      });
      const onComposerSend = contextSafe(() => {
        if (reduceMotionQuery.matches) return;
        gsap
          .timeline()
          .to(root, { scale: 1.08, duration: 0.22, ease: 'power2.out' })
          .to(root, { scale: 1, duration: 0.9, ease: 'elastic.out(1, 0.6)' });
      });
      window.addEventListener(COMPOSER_FOCUS_EVENT, onComposerFocus);
      window.addEventListener(COMPOSER_SEND_EVENT, onComposerSend);

      const animations: gsap.core.Animation[] = [];
      const syncVisibility = () => {
        for (const animation of animations) {
          animation.paused(document.hidden);
        }
      };
      const media = gsap.matchMedia();

      media.add(
        {
          compact: '(max-width: 640px)',
          wide: '(min-width: 641px)',
          reduceMotion: '(prefers-reduced-motion: reduce)',
        },
        (context) => {
          const { compact, reduceMotion } = context.conditions as {
            compact: boolean;
            reduceMotion: boolean;
          };

          if (reduceMotion) {
            gsap.set(haze, { autoAlpha: compact ? 0.36 : 0.44, scale: 1 });
            gsap.set(bloom, { autoAlpha: compact ? 0 : 0.34, scale: 1 });
            gsap.set(core, { autoAlpha: compact ? 0.54 : 0.58, scale: 1 });
            return;
          }

          const visibleLayers = compact ? [haze, core] : [haze, bloom, core];
          gsap.set(bloom, { autoAlpha: compact ? 0 : 0.34 });

          const breathing = gsap.timeline({
            paused: true,
            repeat: -1,
            yoyo: true,
          });
          breathing.fromTo(
            core,
            { scale: 1, x: 0, opacity: compact ? 0.54 : 0.58 },
            {
              scale: compact ? 1.035 : 1.055,
              x: compact ? 0 : 8,
              opacity: compact ? 0.62 : 0.66,
              duration: 5.8,
              ease: 'sine.inOut',
              immediateRender: false,
            },
          );
          if (!compact) {
            breathing.fromTo(
              haze,
              { scale: 1, x: 0, opacity: 0.44 },
              {
                scale: 1.025,
                x: -10,
                opacity: 0.5,
                duration: 5.8,
                ease: 'sine.inOut',
                immediateRender: false,
              },
              0,
            );
            breathing.fromTo(
              bloom,
              { scale: 1, y: 0, opacity: 0.34 },
              {
                scale: 1.04,
                y: -7,
                opacity: 0.4,
                duration: 5.8,
                ease: 'sine.inOut',
                immediateRender: false,
              },
              0,
            );
          }

          const intro = gsap.timeline({
            onComplete: () => {
              if (!document.hidden) breathing.play();
            },
          });
          intro.fromTo(
            visibleLayers,
            { autoAlpha: 0, scale: 0.97 },
            {
              autoAlpha: (index) =>
                compact
                  ? index === 0
                    ? 0.36
                    : 0.54
                  : [0.44, 0.34, 0.58][index]!,
              scale: 1,
              duration: 1.15,
              stagger: 0.08,
              ease: 'power2.out',
            },
          );

          animations.push(intro, breathing);
          syncVisibility();
          return () => {
            intro.kill();
            breathing.kill();
            animations.length = 0;
          };
        },
      );

      document.addEventListener('visibilitychange', syncVisibility);
      return () => {
        document.removeEventListener('visibilitychange', syncVisibility);
        window.removeEventListener(COMPOSER_FOCUS_EVENT, onComposerFocus);
        window.removeEventListener(COMPOSER_SEND_EVENT, onComposerSend);
        media.revert();
      };
    },
    { scope: rootRef },
  );

  return (
    <div ref={rootRef} aria-hidden="true" className="ambient-halo">
      <div ref={hazeRef} className="ambient-halo__layer ambient-halo__haze">
        <div className="ambient-halo__visual" />
      </div>
      <div ref={bloomRef} className="ambient-halo__layer ambient-halo__bloom">
        <div className="ambient-halo__visual" />
      </div>
      <div ref={coreRef} className="ambient-halo__layer ambient-halo__core">
        <div className="ambient-halo__visual" />
      </div>
    </div>
  );
}
