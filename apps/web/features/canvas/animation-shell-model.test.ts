import { describe, expect, it } from 'vitest';
import { clampStepIndex, getNextPlaybackStop } from './animation-shell-model';

const steps = [
  'input',
  'feature_extraction',
  'classification',
  'output',
] as const;

describe('animation shell control model', () => {
  it('clamps arbitrary jump input to a registered step', () => {
    expect(clampStepIndex(-9, steps.length)).toBe(0);
    expect(clampStepIndex(99, steps.length)).toBe(3);
    expect(clampStepIndex(1.6, steps.length)).toBe(2);
  });

  it('reduced motion advances to the next authored pause point', () => {
    const pausePoints = new Set(['classification'] as const);
    expect(getNextPlaybackStop(0, steps, pausePoints)).toBe(2);
    expect(getNextPlaybackStop(2, steps, pausePoints)).toBe(3);
  });

  it('falls through to the final step when no later pause exists', () => {
    expect(getNextPlaybackStop(0, steps, new Set())).toBe(3);
  });
});
