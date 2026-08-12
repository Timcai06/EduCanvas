'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import MorphSVGPlugin from 'gsap/MorphSVGPlugin';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { motionDuration } from '@/features/theme/motion';
import { PHASE_MOTION, type LiveVoiceVisualPhase } from './live-voice-motion';
import {
  computeFlyDelta,
  toLiveVoiceRect,
  type LiveVoiceEntryCapture,
  type LiveVoiceThresholdPhase,
} from './live-voice-threshold';

gsap.registerPlugin(useGSAP, MorphSVGPlugin);

export interface LiveVoiceThresholdMotionOptions {
  readonly thresholdPhase: LiveVoiceThresholdPhase;
  readonly entryCapture: LiveVoiceEntryCapture | null;
  readonly onEntered?: () => void;
  readonly onExited?: () => void;
}

/**
 * Live 只保留一条 MorphSVG 常驻循环。状态变化、声压响应和门槛转场都作用于
 * 同一个球体容器；后台标签页主动暂停，避免不可见时持续消耗图形资源。
 */
export function useLiveVoiceMotion(
  rootRef: RefObject<HTMLElement | null>,
  phase: LiveVoiceVisualPhase,
  transcriptKey: string,
  audioLevel = 0,
  threshold?: LiveVoiceThresholdMotionOptions,
): void {
  const morphLoopRef = useRef<gsap.core.Timeline | null>(null);
  const phaseTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const reactiveScaleRef = useRef<((value: number) => void) | null>(null);
  const [motionPreferenceVersion, setMotionPreferenceVersion] = useState(0);
  const thresholdPhase = threshold?.thresholdPhase ?? null;
  const onEnteredRef = useRef(threshold?.onEntered);
  const onExitedRef = useRef(threshold?.onExited);
  const entryCaptureRef = useRef<LiveVoiceEntryCapture | null>(
    threshold?.entryCapture ?? null,
  );

  useEffect(() => {
    onEnteredRef.current = threshold?.onEntered;
    onExitedRef.current = threshold?.onExited;
    entryCaptureRef.current = threshold?.entryCapture ?? null;
  });

  const { contextSafe } = useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const orbWrap = rootRef.current?.querySelector<HTMLElement>(
          '[data-live-orb-wrap]',
        );
        const reactiveOrb = rootRef.current?.querySelector<HTMLElement>(
          '[data-live-orb-reactive]',
        );
        if (reactiveOrb) {
          const scale = gsap.quickTo(reactiveOrb, 'scale', {
            duration: 0.1,
            ease: 'power2.out',
          });
          reactiveScaleRef.current = scale;
        }

        let entrance: gsap.core.Timeline | null = null;
        if (thresholdPhase === 'entering') {
          const buttonRect = entryCaptureRef.current?.buttonRect ?? null;
          const flyFrom =
            buttonRect && orbWrap
              ? computeFlyDelta(
                  buttonRect,
                  toLiveVoiceRect(orbWrap.getBoundingClientRect()),
                )
              : null;
          entrance = gsap
            .timeline({
              defaults: { ease: 'power3.out' },
              onComplete: () => onEnteredRef.current?.(),
            })
            .fromTo(
              '[data-live-stage]',
              { autoAlpha: 0 },
              { autoAlpha: 1, duration: motionDuration('standard') },
            )
            .fromTo(
              '[data-live-orb-wrap]',
              flyFrom
                ? {
                    autoAlpha: 0,
                    scale: 0.32,
                    x: flyFrom.dx,
                    y: flyFrom.dy,
                  }
                : { autoAlpha: 0, scale: 0.78 },
              {
                autoAlpha: 1,
                scale: 1,
                x: 0,
                y: 0,
                duration: 0.72,
              },
              0,
            )
            .fromTo(
              '[data-live-copy], [data-live-controls], [data-live-visual-stage]',
              { autoAlpha: 0, y: 10 },
              {
                autoAlpha: 1,
                y: 0,
                duration: motionDuration('emphasis'),
                stagger: 0.04,
              },
              0.12,
            );
        }

        return () => {
          entrance?.kill();
          reactiveScaleRef.current = null;
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
    const normalized = Math.min(1, Math.max(0, audioLevel));
    reactiveScaleRef.current?.(reduced ? 1 : 1 + normalized * 0.12);
  }, [audioLevel]);

  useEffect(() => {
    if (thresholdPhase === null) return undefined;
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (!reduced) return undefined;
    if (thresholdPhase === 'entering') {
      const frame = requestAnimationFrame(() => onEnteredRef.current?.());
      return () => cancelAnimationFrame(frame);
    }
    if (thresholdPhase === 'exiting') {
      const frame = requestAnimationFrame(() => onExitedRef.current?.());
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [thresholdPhase]);

  useEffect(() => {
    if (thresholdPhase !== 'exiting') return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }
    const playExit = contextSafe(() => {
      const orbWrap = rootRef.current?.querySelector<HTMLElement>(
        '[data-live-orb-wrap]',
      );
      const buttonRect = entryCaptureRef.current?.buttonRect ?? null;
      let orbVars: gsap.TweenVars = { autoAlpha: 0, scale: 0.68 };
      if (orbWrap && buttonRect) {
        const delta = computeFlyDelta(
          buttonRect,
          toLiveVoiceRect(orbWrap.getBoundingClientRect()),
        );
        orbVars = {
          ...orbVars,
          x: (Number(gsap.getProperty(orbWrap, 'x')) || 0) + delta.dx,
          y: (Number(gsap.getProperty(orbWrap, 'y')) || 0) + delta.dy,
          scale: 0.28,
        };
      }
      return gsap
        .timeline({
          defaults: { ease: 'power2.in' },
          onComplete: () => onExitedRef.current?.(),
        })
        .to(
          '[data-live-copy], [data-live-controls], [data-live-visual-stage], [data-live-resource-preview], [data-live-answer-reader]',
          {
            autoAlpha: 0,
            y: 8,
            duration: motionDuration('fast'),
          },
          0,
        )
        .to(
          '[data-live-orb-wrap]',
          { ...orbVars, duration: motionDuration('emphasis') },
          0.03,
        )
        .to(
          '[data-live-stage]',
          { autoAlpha: 0, duration: motionDuration('standard') },
          0.12,
        );
    });
    const timeline = playExit();
    return () => {
      timeline?.kill();
    };
  }, [contextSafe, rootRef, thresholdPhase]);

  useEffect(() => {
    const transition = contextSafe(() => {
      const target =
        rootRef.current?.querySelector<SVGPathElement>('[data-live-morph]');
      if (!target) return;
      const motion = PHASE_MOTION[phase];
      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      phaseTimelineRef.current?.kill();
      morphLoopRef.current?.kill();

      if (reduced) {
        gsap.set(target, {
          morphSVG: { shape: motion.shapes[0]!, type: 'rotational' },
        });
        gsap.set('[data-live-orb]', { scale: motion.scale });
        gsap.set('[data-live-glow]', { opacity: motion.energy });
        return;
      }

      phaseTimelineRef.current = gsap
        .timeline({
          defaults: { ease: 'power2.out' },
          onComplete: () => {
            const loopShapes = [...motion.shapes.slice(1), motion.shapes[0]!];
            morphLoopRef.current = gsap.timeline({
              repeat: -1,
              paused: document.hidden,
              defaults: { ease: 'sine.inOut' },
            });
            loopShapes.forEach((shape) => {
              morphLoopRef.current?.to(target, {
                morphSVG: { shape, type: 'rotational' },
                duration: motion.morphDuration,
              });
            });
          },
        })
        .to(
          target,
          {
            morphSVG: { shape: motion.shapes[0]!, type: 'rotational' },
            duration: Math.min(0.65, motion.morphDuration * 0.5),
          },
          0,
        )
        .to(
          '[data-live-orb]',
          {
            scale: motion.scale,
            transformOrigin: '50% 50%',
            duration: motionDuration('emphasis'),
          },
          0,
        )
        .to(
          '[data-live-glow]',
          { opacity: motion.energy, duration: motionDuration('emphasis') },
          0,
        )
        .fromTo(
          '[data-live-status-copy]',
          { autoAlpha: 0.62, y: 2 },
          {
            autoAlpha: 1,
            y: 0,
            duration: motionDuration('standard'),
          },
          0,
        );
    });
    transition();
    return () => {
      phaseTimelineRef.current?.kill();
      morphLoopRef.current?.kill();
    };
  }, [contextSafe, motionPreferenceVersion, phase, rootRef]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setMotionPreferenceVersion((value) => value + 1);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) morphLoopRef.current?.pause();
      else if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        morphLoopRef.current?.resume();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const cue = gsap.fromTo(
          '[data-live-active-line]',
          { autoAlpha: 0, y: 6 },
          {
            autoAlpha: 1,
            y: 0,
            duration: motionDuration('standard'),
            ease: 'power2.out',
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
