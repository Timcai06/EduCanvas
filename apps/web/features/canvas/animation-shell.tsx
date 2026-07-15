'use client';

import type { PipelineFlowSlot } from '@educanvas/canvas-protocol';
import { useGSAP } from '@gsap/react';
import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  Pause,
  Play,
} from '@phosphor-icons/react';
import gsap from 'gsap';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  clampStepIndex,
  getNextPlaybackStop,
  shouldIgnorePlaybackShortcut,
} from './animation-shell-model';

export type AnimationClientObservation =
  | {
      type: 'animation_started';
      templateKey: 'pipeline_flow';
      stepId: PipelineFlowSlot;
    }
  | {
      type: 'animation_paused';
      templateKey: 'pipeline_flow';
      stepId: PipelineFlowSlot;
      positionMs: number;
    }
  | {
      type: 'animation_step_completed';
      templateKey: 'pipeline_flow';
      stepId: PipelineFlowSlot;
      stepIndex: number;
    };

interface AnimationStepSummary {
  id: PipelineFlowSlot;
  label: string;
}

interface AnimationShellRenderState {
  currentStep: number;
  isComplete: boolean;
}

const speeds = [0.75, 1, 1.25, 1.5] as const;

function subscribeReducedMotion(callback: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

function getReducedMotionSnapshot() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getServerReducedMotionSnapshot() {
  return false;
}

/**
 * Human-authored playback shell for registered templates. The model supplies
 * only semantic slots and copy; this component owns selectors, timing, easing,
 * keyboard behavior and lifecycle cleanup.
 */
export function AnimationShell({
  steps,
  pausePoints,
  children,
  onObservation,
}: {
  steps: readonly AnimationStepSummary[];
  pausePoints: readonly PipelineFlowSlot[];
  children:
    | ReactNode
    | ((state: AnimationShellRenderState) => ReactNode);
  onObservation?: (observation: AnimationClientObservation) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);
  const [speed, setSpeed] = useState<(typeof speeds)[number]>(1);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getServerReducedMotionSnapshot,
  );
  const stepIds = useMemo(() => steps.map((step) => step.id), [steps]);
  const stepKey = stepIds.join(':');
  const pauseKey = pausePoints.join(':');
  const pauseSet = useMemo(() => new Set(pausePoints), [pausePoints]);

  const applyVisualState = useCallback((index: number) => {
    const root = rootRef.current;
    if (!root) return;
    const cards = Array.from(
      root.querySelectorAll<HTMLElement>('[data-animation-step]'),
    );
    const connectors = Array.from(
      root.querySelectorAll<HTMLElement>('[data-animation-connector]'),
    );
    gsap.set(cards, { opacity: 0.64, scale: 0.97 });
    gsap.set(cards.slice(0, index), { opacity: 0.82, scale: 1 });
    if (cards[index]) gsap.set(cards[index], { opacity: 1, scale: 1 });
    gsap.set(connectors, {
      opacity: 0.35,
      scaleX: 0,
      transformOrigin: 'left center',
    });
    gsap.set(connectors.slice(0, index), { opacity: 1, scaleX: 1 });
  }, []);

  const { contextSafe } = useGSAP(
    () => {
      if (reducedMotion || steps.length === 0) {
        timelineRef.current = null;
        applyVisualState(currentStep);
        return;
      }

      const root = rootRef.current;
      if (!root) return;
      let active = true;
      const cards = Array.from(
        root.querySelectorAll<HTMLElement>('[data-animation-step]'),
      );
      const connectors = Array.from(
        root.querySelectorAll<HTMLElement>('[data-animation-connector]'),
      );
      const timeline = gsap.timeline({
        paused: true,
        defaults: { duration: 0.42, ease: 'power2.out' },
        onComplete: () => {
          if (!active) return;
          setCurrentStep(Math.max(steps.length - 1, 0));
          setIsPlaying(false);
          setHasCompleted(true);
        },
      });

      timeline.set(cards, { opacity: 0.64, scale: 0.97 }, 0);
      timeline.set(connectors, {
        opacity: 0.35,
        scaleX: 0,
        transformOrigin: 'left center',
      }, 0);

      steps.forEach((step, index) => {
        const card = cards[index];
        if (!card) return;
        timeline.addLabel(`step-${index}`);
        const previousCard = cards[index - 1];
        if (index > 0 && previousCard) {
          timeline.to(previousCard, { opacity: 0.82, duration: 0.2 });
        }
        const previousConnector = connectors[index - 1];
        if (index > 0 && previousConnector) {
          timeline.to(
            previousConnector,
            { opacity: 1, scaleX: 1, duration: 0.32 },
            '<',
          );
        }
        timeline.to(
          card,
          {
            opacity: 1,
            scale: 1,
            onStart: () => {
              if (active) setCurrentStep(index);
            },
            onComplete: () => {
              if (!active) return;
              onObservation?.({
                type: 'animation_step_completed',
                templateKey: 'pipeline_flow',
                stepId: step.id,
                stepIndex: index,
              });
            },
          },
          index > 0 ? '<0.1' : undefined,
        );
        timeline.addLabel(`settled-${index}`);
        if (pauseSet.has(step.id) && index < steps.length - 1) {
          timeline.addPause(undefined, () => {
            if (!active) return;
            setCurrentStep(index);
            setIsPlaying(false);
            onObservation?.({
              type: 'animation_paused',
              templateKey: 'pipeline_flow',
              stepId: step.id,
              positionMs: Math.round(timeline.time() * 1000),
            });
          });
        }
      });

      timeline.timeScale(speed);
      timelineRef.current = timeline;
      timeline.seek(`settled-${clampStepIndex(currentStep, steps.length)}`);
      timeline.pause();

      return () => {
        active = false;
        timelineRef.current = null;
        timeline.kill();
      };
    },
    {
      scope: rootRef,
      dependencies: [stepKey, pauseKey, reducedMotion],
      revertOnUpdate: true,
    },
  );

  const applyControlledVisualState = useCallback(
    (index: number) => contextSafe(() => applyVisualState(index))(),
    [applyVisualState, contextSafe],
  );

  useEffect(() => {
    timelineRef.current?.timeScale(speed);
  }, [speed]);

  const jumpTo = useCallback(
    (requestedIndex: number) => {
      const index = clampStepIndex(requestedIndex, steps.length);
      timelineRef.current?.pause().seek(`settled-${index}`);
      applyControlledVisualState(index);
      setCurrentStep(index);
      setIsPlaying(false);
      setHasCompleted(false);
    },
    [applyControlledVisualState, steps.length],
  );

  const play = useCallback(() => {
    if (steps.length === 0) return;
    const startIndex =
      currentStep >= steps.length - 1 ? 0 : clampStepIndex(currentStep, steps.length);
    onObservation?.({
      type: 'animation_started',
      templateKey: 'pipeline_flow',
      stepId: steps[startIndex]!.id,
    });

    if (reducedMotion) {
      const target = getNextPlaybackStop(
        startIndex,
        stepIds,
        pauseSet,
      );
      applyControlledVisualState(target);
      setCurrentStep(target);
      setIsPlaying(false);
      setHasCompleted(target === steps.length - 1);
      for (let index = startIndex; index <= target; index += 1) {
        const step = steps[index];
        if (!step) continue;
        onObservation?.({
          type: 'animation_step_completed',
          templateKey: 'pipeline_flow',
          stepId: step.id,
          stepIndex: index,
        });
      }
      const stoppedStep = steps[target];
      if (stoppedStep && pauseSet.has(stoppedStep.id) && target < steps.length - 1) {
        onObservation?.({
          type: 'animation_paused',
          templateKey: 'pipeline_flow',
          stepId: stoppedStep.id,
          positionMs: 0,
        });
      }
      return;
    }

    const timeline = timelineRef.current;
    if (!timeline) return;
    if (currentStep >= steps.length - 1) {
      setHasCompleted(false);
      timeline.seek('step-0');
    }
    timeline.play();
    setIsPlaying(true);
  }, [
    applyControlledVisualState,
    currentStep,
    onObservation,
    pauseSet,
    reducedMotion,
    stepIds,
    steps,
  ]);

  const pause = useCallback(() => {
    const timeline = timelineRef.current;
    timeline?.pause();
    setIsPlaying(false);
    const step = steps[clampStepIndex(currentStep, steps.length)];
    if (!step) return;
    onObservation?.({
      type: 'animation_paused',
      templateKey: 'pipeline_flow',
      stepId: step.id,
      positionMs: Math.round((timeline?.time() ?? 0) * 1000),
    });
  }, [currentStep, onObservation, steps]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && timelineRef.current?.isActive()) {
        pause();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [pause]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (shouldIgnorePlaybackShortcut(event.target)) return;
    if (event.key === ' ') {
      event.preventDefault();
      if (isPlaying) pause();
      else play();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      jumpTo(currentStep - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      jumpTo(currentStep + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      jumpTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      jumpTo(steps.length - 1);
    }
  };

  const currentLabel = steps[currentStep]?.label ?? '未开始';
  const isComplete = steps.length > 0 && hasCompleted;

  return (
    <div
      ref={rootRef}
      className="space-y-5"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="流程动画，空格播放或暂停，方向键切换步骤"
      data-testid="animation-shell"
    >
      <div className="relative">
        {typeof children === 'function'
          ? children({ currentStep, isComplete })
          : children}
      </div>

      <div className="rounded-2xl border border-line/70 bg-surface/85 p-3 shadow-lg shadow-black/20">
        <div className="mb-3 flex items-center justify-between gap-3 text-sm">
          <p aria-live="polite" className="min-w-0 truncate text-ink-muted">
            步骤 {currentStep + 1}/{steps.length} ·{' '}
            <span className="text-ink">{currentLabel}</span>
          </p>
          {reducedMotion ? (
            <span className="shrink-0 rounded-full bg-accent-soft px-2 py-1 text-xs text-accent-strong">
              减少动态
            </span>
          ) : null}
        </div>

        <input
          aria-label="跳转流程步骤"
          type="range"
          min={0}
          max={Math.max(steps.length - 1, 0)}
          value={currentStep}
          onChange={(event) => jumpTo(Number(event.target.value))}
          className="mb-3 w-full accent-accent"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => jumpTo(0)}
            aria-label="重置流程"
            className="grid size-11 place-items-center rounded-full text-ink-muted hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ArrowCounterClockwise aria-hidden="true" size={20} />
          </button>
          <button
            type="button"
            onClick={() => jumpTo(currentStep - 1)}
            disabled={currentStep === 0}
            aria-label="上一步"
            className="grid size-11 place-items-center rounded-full text-ink-muted hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-35"
          >
            <CaretLeft aria-hidden="true" size={20} />
          </button>
          <button
            type="button"
            onClick={isPlaying ? pause : play}
            aria-label={isPlaying ? '暂停流程' : '播放流程'}
            className="grid size-11 place-items-center rounded-full bg-accent text-white hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {isPlaying ? (
              <Pause aria-hidden="true" size={20} weight="fill" />
            ) : (
              <Play aria-hidden="true" size={20} weight="fill" />
            )}
          </button>
          <button
            type="button"
            onClick={() => jumpTo(currentStep + 1)}
            disabled={currentStep >= steps.length - 1}
            aria-label="下一步"
            className="grid size-11 place-items-center rounded-full text-ink-muted hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-35"
          >
            <CaretRight aria-hidden="true" size={20} />
          </button>
          <label className="ml-auto flex min-h-11 items-center gap-2 text-sm text-ink-muted">
            <span>速度</span>
            <select
              aria-label="播放速度"
              value={speed}
              onChange={(event) =>
                setSpeed(Number(event.target.value) as (typeof speeds)[number])
              }
              disabled={reducedMotion}
              className="min-h-10 rounded-lg border border-line bg-canvas px-2 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              {speeds.map((option) => (
                <option key={option} value={option}>
                  {option}×
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <p className="sr-only">
        动画播放只记录客户端观察事件，不代表答题正确或知识掌握。
      </p>
    </div>
  );
}
