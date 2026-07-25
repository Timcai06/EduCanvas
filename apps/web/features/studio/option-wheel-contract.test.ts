import { describe, expect, it } from 'vitest';
import { clampOptionWheelIndex } from './option-wheel-contract';

describe('OptionWheel contract', () => {
  it('clamps non-looping selection to the available range', () => {
    expect(clampOptionWheelIndex(-3, 4)).toBe(0);
    expect(clampOptionWheelIndex(2.4, 4)).toBe(2);
    expect(clampOptionWheelIndex(9, 4)).toBe(3);
  });

  it('keeps an empty wheel on its inert zero index', () => {
    expect(clampOptionWheelIndex(3, 0)).toBe(0);
  });
});
