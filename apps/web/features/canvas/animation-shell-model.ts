import type { PipelineFlowSlot } from '@educanvas/canvas-protocol';

/** Clamp all control input before it reaches a GSAP timeline. */
export function clampStepIndex(index: number, stepCount: number) {
  if (stepCount <= 0) return 0;
  return Math.min(Math.max(Math.round(index), 0), stepCount - 1);
}

/**
 * Reduced-motion playback advances synchronously to the next authored pause or
 * the final step. It never synthesizes a learning result.
 */
export function getNextPlaybackStop(
  currentIndex: number,
  steps: readonly PipelineFlowSlot[],
  pausePoints: ReadonlySet<PipelineFlowSlot>,
) {
  const current = clampStepIndex(currentIndex, steps.length);
  for (let index = current + 1; index < steps.length; index += 1) {
    const slot = steps[index];
    if (slot && pausePoints.has(slot)) return index;
  }
  return Math.max(steps.length - 1, 0);
}

export function shouldIgnorePlaybackShortcut(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('button, input, select, textarea, a'))
  );
}
