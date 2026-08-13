import { describe, expect, it } from 'vitest';

import {
  createPetMouseTracker,
  isPetInteractiveScreenPoint,
} from '../src/main/pet-mouse-tracker';

describe('desktop pet mouse tracker', () => {
  it('distinguishes the visible chat and pet rectangles from transparent space', () => {
    const windowBounds = { x: 100, y: 200, width: 502, height: 242 };

    expect(isPetInteractiveScreenPoint(windowBounds, { x: 200, y: 300 })).toBe(
      true,
    );
    expect(isPetInteractiveScreenPoint(windowBounds, { x: 500, y: 340 })).toBe(
      true,
    );
    expect(isPetInteractiveScreenPoint(windowBounds, { x: 412, y: 220 })).toBe(
      false,
    );
    expect(isPetInteractiveScreenPoint(windowBounds, { x: 594, y: 205 })).toBe(
      false,
    );
    expect(isPetInteractiveScreenPoint(windowBounds, { x: 450, y: 283 })).toBe(
      false,
    );
    expect(isPetInteractiveScreenPoint(windowBounds, { x: 450, y: 284 })).toBe(
      true,
    );
    expect(isPetInteractiveScreenPoint(windowBounds, { x: 418, y: 260 })).toBe(
      false,
    );
  });

  it('switches system passthrough only when the pointer crosses a hit boundary', () => {
    let cursor = { x: 412, y: 220 };
    let tick: (() => void) | undefined;
    const passthroughStates: boolean[] = [];
    const tracker = createPetMouseTracker({
      readCursor: () => cursor,
      readWindowBounds: () => ({ x: 100, y: 200, width: 502, height: 242 }),
      setMousePassthrough: (passthrough) => passthroughStates.push(passthrough),
      schedule: (callback) => {
        tick = callback;
        return 17;
      },
      cancelSchedule: () => undefined,
    });

    tracker.start();
    expect(passthroughStates).toEqual([true]);

    cursor = { x: 500, y: 340 };
    tick?.();
    tick?.();
    expect(passthroughStates).toEqual([true, false]);
  });

  it('lets clicks pass through the hidden chat area after the dialog is folded', () => {
    const windowBounds = { x: 100, y: 200, width: 502, height: 242 };

    expect(
      isPetInteractiveScreenPoint(windowBounds, { x: 200, y: 300 }, false),
    ).toBe(false);
    expect(
      isPetInteractiveScreenPoint(windowBounds, { x: 500, y: 340 }, false),
    ).toBe(true);
  });

  it('keeps the visible restore-chat button clickable while the dialog is folded', () => {
    const windowBounds = { x: 100, y: 200, width: 502, height: 242 };

    expect(
      isPetInteractiveScreenPoint(windowBounds, { x: 430, y: 345 }, false),
    ).toBe(true);
  });

  it('updates passthrough immediately when the chat dialog is folded', () => {
    let chatExpanded = true;
    let tick: (() => void) | undefined;
    const passthroughStates: boolean[] = [];
    const tracker = createPetMouseTracker({
      readCursor: () => ({ x: 200, y: 300 }),
      readWindowBounds: () => ({ x: 100, y: 200, width: 502, height: 242 }),
      isChatExpanded: () => chatExpanded,
      setMousePassthrough: (passthrough) => passthroughStates.push(passthrough),
      schedule: (callback) => {
        tick = callback;
        return 17;
      },
      cancelSchedule: () => undefined,
    });

    tracker.start();
    chatExpanded = false;
    tick?.();

    expect(passthroughStates).toEqual([false, true]);
  });

  it('stops while hidden and restarts with an immediate hit test', () => {
    const callbacks: Array<() => void> = [];
    const cancelled: number[] = [];
    const states: boolean[] = [];
    const tracker = createPetMouseTracker({
      readCursor: () => ({ x: 412, y: 220 }),
      readWindowBounds: () => ({ x: 100, y: 200, width: 502, height: 242 }),
      setMousePassthrough: (passthrough) => states.push(passthrough),
      schedule: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelSchedule: (handle) => cancelled.push(handle),
    });

    tracker.start();
    tracker.stop();
    tracker.start();

    expect(cancelled).toEqual([1]);
    expect(states).toEqual([true, true]);
  });
});
