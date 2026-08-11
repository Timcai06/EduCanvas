'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import MorphSVGPlugin from 'gsap/MorphSVGPlugin';
import { useEffect, useRef, type RefObject } from 'react';
import { motionDuration } from '@/features/theme/motion';
import { PHASE_MOTION, type LiveVoiceVisualPhase } from './live-voice-motion';

gsap.registerPlugin(useGSAP, MorphSVGPlugin);

const PHASE_AMBIENT_SPEED: Record<LiveVoiceVisualPhase, number> = {
  idle: 0.55,
  connecting: 0.72,
  listening: 1,
  thinking: 1.18,
  speaking: 1.45,
  muted: 0.32,
  error: 0.28,
};

const PHASE_FIELD_OPACITY: Record<LiveVoiceVisualPhase, number> = {
  idle: 0.48,
  connecting: 0.56,
  listening: 0.72,
  thinking: 0.66,
  speaking: 0.82,
  muted: 0.24,
  error: 0.2,
};

const PHASE_AURA_OPACITY: Record<LiveVoiceVisualPhase, number> = {
  idle: 0.5,
  connecting: 0.62,
  listening: 0.84,
  thinking: 0.74,
  speaking: 1,
  muted: 0.2,
  error: 0.24,
};

const PHASE_AURA_SPEED: Record<LiveVoiceVisualPhase, number> = {
  idle: 0.45,
  connecting: 0.72,
  listening: 1,
  thinking: 1.32,
  speaking: 1.65,
  muted: 0.22,
  error: 0.18,
};

/**
 * Live 的氛围循环只创建一次；phase 变化从当前视觉值平滑调参，避免重建
 * infinite timeline 时把 SVG 瞬间还原到初始路径。
 */
export function useLiveVoiceMotion(
  rootRef: RefObject<HTMLElement | null>,
  phase: LiveVoiceVisualPhase,
  transcriptKey: string,
  audioLevel = 0,
): void {
  const ambientTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const ringTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const phaseTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const morphLoopRef = useRef<gsap.core.Timeline | null>(null);
  const auraTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const reactiveScaleRef = useRef<((value: number) => void) | null>(null);
  const auraScaleRef = useRef<((value: number) => void) | null>(null);

  const { contextSafe } = useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const stage =
          rootRef.current?.querySelector<HTMLElement>('[data-live-stage]');
        const orbWrap = rootRef.current?.querySelector<HTMLElement>(
          '[data-live-orb-wrap]',
        );
        const fieldLayer = rootRef.current?.querySelector<HTMLElement>(
          '[data-live-field-layer]',
        );
        const reactiveOrb = rootRef.current?.querySelector<HTMLElement>(
          '[data-live-orb-reactive]',
        );
        const reactiveAura = rootRef.current?.querySelector<SVGGElement>(
          '[data-live-aura-reactive]',
        );
        const auraShell = rootRef.current?.querySelector<HTMLElement>(
          '[data-live-aura-shell]',
        );
        if (reactiveOrb) {
          const scaleX = gsap.quickTo(reactiveOrb, 'scaleX', {
            duration: 0.085,
            ease: 'power1.out',
          });
          const scaleY = gsap.quickTo(reactiveOrb, 'scaleY', {
            duration: 0.085,
            ease: 'power1.out',
          });
          reactiveScaleRef.current = (value) => {
            scaleX(value);
            scaleY(value);
          };
        }
        if (reactiveAura) {
          const scaleX = gsap.quickTo(reactiveAura, 'scaleX', {
            duration: 0.12,
            ease: 'power2.out',
          });
          const scaleY = gsap.quickTo(reactiveAura, 'scaleY', {
            duration: 0.12,
            ease: 'power2.out',
          });
          auraScaleRef.current = (value) => {
            scaleX(value);
            scaleY(value);
          };
        }
        const orbX = orbWrap
          ? gsap.quickTo(orbWrap, 'x', { duration: 0.8, ease: 'power3.out' })
          : null;
        const orbY = orbWrap
          ? gsap.quickTo(orbWrap, 'y', { duration: 0.8, ease: 'power3.out' })
          : null;
        const fieldX = fieldLayer
          ? gsap.quickTo(fieldLayer, 'x', {
              duration: 1.1,
              ease: 'power3.out',
            })
          : null;
        const fieldY = fieldLayer
          ? gsap.quickTo(fieldLayer, 'y', {
              duration: 1.1,
              ease: 'power3.out',
            })
          : null;
        const auraX = auraShell
          ? gsap.quickTo(auraShell, 'x', {
              duration: 1.2,
              ease: 'power3.out',
            })
          : null;
        const auraY = auraShell
          ? gsap.quickTo(auraShell, 'y', {
              duration: 1.2,
              ease: 'power3.out',
            })
          : null;
        const onPointerMove = (event: PointerEvent) => {
          const normalizedX = event.clientX / window.innerWidth - 0.5;
          const normalizedY = event.clientY / window.innerHeight - 0.5;
          orbX?.(normalizedX * 12);
          orbY?.(normalizedY * 9);
          fieldX?.(normalizedX * -20);
          fieldY?.(normalizedY * -14);
          auraX?.(normalizedX * -14);
          auraY?.(normalizedY * -10);
        };
        const onPointerLeave = () => {
          orbX?.(0);
          orbY?.(0);
          fieldX?.(0);
          fieldY?.(0);
          auraX?.(0);
          auraY?.(0);
        };
        stage?.addEventListener('pointermove', onPointerMove, {
          passive: true,
        });
        stage?.addEventListener('pointerleave', onPointerLeave);

        const entrance = gsap
          .timeline({ defaults: { ease: 'power3.out' } })
          .fromTo(
            '[data-live-stage]',
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: motionDuration('standard') },
          )
          .fromTo(
            '[data-live-orb-wrap]',
            { autoAlpha: 0, scale: 0.86 },
            {
              autoAlpha: 1,
              scale: 1,
              duration: motionDuration('hero'),
            },
            0,
          )
          .fromTo(
            '[data-live-aura-shell]',
            { autoAlpha: 0, scale: 0.62, rotation: -10 },
            {
              autoAlpha: 1,
              scale: 1,
              rotation: 0,
              duration: motionDuration('hero'),
            },
            0.04,
          )
          .fromTo(
            '[data-live-copy], [data-live-controls]',
            { autoAlpha: 0, y: 10 },
            {
              autoAlpha: 1,
              y: 0,
              duration: motionDuration('emphasis'),
              stagger: 0.07,
            },
            0.14,
          )
          .fromTo(
            '[data-live-visual-stage]',
            { autoAlpha: 0, x: 20 },
            {
              autoAlpha: 1,
              x: 0,
              duration: motionDuration('hero'),
            },
            0.18,
          )
          .fromTo(
            '[data-live-visual-stage] [role="listitem"]',
            { autoAlpha: 0, y: 6 },
            {
              autoAlpha: 1,
              y: 0,
              duration: motionDuration('standard'),
              stagger: 0.035,
            },
            0.24,
          );

        ambientTimelineRef.current = gsap
          .timeline({ repeat: -1, yoyo: true })
          .to(
            '[data-live-light="a"], [data-live-field="a"]',
            {
              x: 22,
              y: -16,
              rotation: 18,
              scale: 1.12,
              duration: 6.8,
              ease: 'sine.inOut',
            },
            0,
          )
          .to(
            '[data-live-light="b"], [data-live-field="b"]',
            {
              x: -24,
              y: 19,
              rotation: -22,
              scale: 1.16,
              duration: 6.2,
              ease: 'sine.inOut',
            },
            0,
          )
          .to(
            '[data-live-light="c"], [data-live-field="c"]',
            {
              x: 12,
              y: 20,
              scale: 0.88,
              duration: 5.4,
              ease: 'sine.inOut',
            },
            0,
          )
          .to(
            '[data-live-field="d"]',
            {
              x: -18,
              y: -14,
              rotation: 14,
              scale: 1.1,
              duration: 7.4,
              ease: 'sine.inOut',
            },
            0,
          );

        auraTimelineRef.current = gsap
          .timeline({ repeat: -1 })
          .to(
            '[data-live-aura-layer="a"]',
            { rotation: 360, duration: 18, ease: 'none' },
            0,
          )
          .to(
            '[data-live-aura-layer="b"]',
            { rotation: -360, duration: 25, ease: 'none' },
            0,
          )
          .to(
            '[data-live-aura-layer="c"]',
            { rotation: 360, duration: 32, ease: 'none' },
            0,
          )
          .to(
            '[data-live-particle-orbit]',
            {
              rotation: 360,
              svgOrigin: '100 100',
              duration: 22,
              ease: 'none',
            },
            0,
          )
          .to(
            '[data-live-sheen]',
            {
              x: 11,
              y: -7,
              autoAlpha: 0.88,
              duration: 3.8,
              ease: 'sine.inOut',
              repeat: 3,
              yoyo: true,
            },
            0,
          );

        gsap.to('[data-live-particle]', {
          autoAlpha: 0.88,
          scale: 1.7,
          transformOrigin: '50% 50%',
          duration: 1.5,
          ease: 'sine.inOut',
          stagger: { each: 0.28, from: 'random' },
          repeat: -1,
          yoyo: true,
        });

        const rings = gsap.utils.toArray<SVGCircleElement>('[data-live-ring]');
        ringTimelineRef.current = gsap.timeline({ repeat: -1, paused: true });
        rings.forEach((ring, index) => {
          const start = index * 0.48;
          ringTimelineRef
            .current!.fromTo(
              ring,
              { autoAlpha: 0, scale: 0.78, transformOrigin: '50% 50%' },
              {
                autoAlpha: 0.24,
                scale: 1,
                duration: 0.42,
                ease: 'power2.out',
              },
              start,
            )
            .to(
              ring,
              {
                autoAlpha: 0,
                scale: 1.92,
                duration: 1.78,
                ease: 'power1.out',
              },
              start + 0.42,
            );
        });

        return () => {
          stage?.removeEventListener('pointermove', onPointerMove);
          stage?.removeEventListener('pointerleave', onPointerLeave);
          entrance.kill();
          ambientTimelineRef.current?.kill();
          ringTimelineRef.current?.kill();
          auraTimelineRef.current?.kill();
          gsap.killTweensOf('[data-live-particle]');
          ambientTimelineRef.current = null;
          ringTimelineRef.current = null;
          auraTimelineRef.current = null;
          reactiveScaleRef.current = null;
          auraScaleRef.current = null;
        };
      });
      return () => media.revert();
    },
    { scope: rootRef },
  );

  useEffect(() => {
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    reactiveScaleRef.current?.(
      reduced ? 1 : 1 + Math.min(1, Math.max(0, audioLevel)) * 0.1,
    );
    auraScaleRef.current?.(
      reduced ? 1 : 1 + Math.min(1, Math.max(0, audioLevel)) * 0.24,
    );
  }, [audioLevel]);

  useEffect(() => {
    const transition = contextSafe(() => {
      const motion = PHASE_MOTION[phase];
      const morphTargets =
        gsap.utils.toArray<SVGPathElement>('[data-live-morph]');
      const ringsActive =
        phase === 'listening' || phase === 'thinking' || phase === 'speaking';
      const reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;

      phaseTimelineRef.current?.kill();
      morphLoopRef.current?.kill();

      if (reducedMotion) {
        gsap.set(morphTargets, {
          morphSVG: {
            shape: motion.shapes[0]!,
            type: 'rotational',
            shapeIndex: 0,
          },
        });
        gsap.set('[data-live-orb]', { scale: 1 });
        gsap.set('[data-live-orb-energy]', { autoAlpha: motion.energy });
        gsap.set('[data-live-field-layer]', {
          autoAlpha: PHASE_FIELD_OPACITY[phase],
          scale: 1,
        });
        gsap.set('[data-live-rings]', { autoAlpha: 0 });
        gsap.set('[data-live-aura-reactive], [data-live-aura-shell]', {
          autoAlpha: PHASE_AURA_OPACITY[phase],
        });
        return;
      }

      if (ringsActive) ringTimelineRef.current?.play();
      else ringTimelineRef.current?.pause(0);

      if (ambientTimelineRef.current) {
        gsap.to(ambientTimelineRef.current, {
          timeScale: PHASE_AMBIENT_SPEED[phase],
          duration: motionDuration('emphasis'),
          ease: 'power2.out',
        });
      }
      if (auraTimelineRef.current) {
        gsap.to(auraTimelineRef.current, {
          timeScale: PHASE_AURA_SPEED[phase],
          duration: motionDuration('emphasis'),
          ease: 'power2.out',
        });
      }

      const startMorphLoop = contextSafe(() => {
        const loopShapes = [...motion.shapes.slice(1), motion.shapes[0]!];
        morphLoopRef.current = gsap.timeline({
          repeat: -1,
          defaults: { ease: 'sine.inOut' },
        });
        loopShapes.forEach((shape) => {
          morphLoopRef.current!.to(morphTargets, {
            morphSVG: { shape, type: 'rotational', shapeIndex: 0 },
            duration: motion.morphDuration,
          });
        });
      });

      phaseTimelineRef.current = gsap
        .timeline({
          defaults: {
            duration: motionDuration('emphasis'),
            ease: 'power2.out',
          },
          onComplete: startMorphLoop,
        })
        .addLabel('phase')
        .to(
          morphTargets,
          {
            morphSVG: {
              shape: motion.shapes[0]!,
              type: 'rotational',
              shapeIndex: 0,
            },
            duration: Math.min(0.72, motion.morphDuration * 0.5),
            ease: 'sine.inOut',
          },
          'phase',
        )
        .to(
          '[data-live-orb]',
          { scale: motion.scale, transformOrigin: '50% 50%' },
          'phase',
        )
        .to('[data-live-orb-energy]', { autoAlpha: motion.energy }, 'phase')
        .to(
          '[data-live-aura-reactive]',
          { autoAlpha: PHASE_AURA_OPACITY[phase] },
          'phase',
        )
        .to(
          '[data-live-aura-shell]',
          {
            autoAlpha: Math.max(0.16, PHASE_AURA_OPACITY[phase] * 0.88),
          },
          'phase',
        )
        .to(
          '[data-live-field-layer]',
          {
            autoAlpha: PHASE_FIELD_OPACITY[phase],
            scale: phase === 'speaking' ? 1.06 : 1,
          },
          'phase',
        )
        .to('[data-live-rings]', { autoAlpha: ringsActive ? 1 : 0 }, 'phase')
        .to(
          '[data-live-sheen]',
          {
            autoAlpha:
              phase === 'speaking' ? 0.95 : phase === 'listening' ? 0.72 : 0.46,
          },
          'phase',
        )
        .fromTo(
          '[data-live-status-copy]',
          { autoAlpha: 0.52, y: 3 },
          { autoAlpha: 1, y: 0 },
          'phase',
        );
    });

    transition();
    return () => {
      phaseTimelineRef.current?.kill();
      morphLoopRef.current?.kill();
    };
  }, [contextSafe, phase]);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const cue = gsap.timeline({ defaults: { ease: 'power2.out' } }).fromTo(
          '[data-live-active-line]',
          { autoAlpha: 0, y: 7, scale: 0.985 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: motionDuration('standard'),
          },
        );
        return () => cue.kill();
      });
      return () => media.revert();
    },
    {
      scope: rootRef,
      dependencies: [transcriptKey],
      revertOnUpdate: true,
    },
  );
}
