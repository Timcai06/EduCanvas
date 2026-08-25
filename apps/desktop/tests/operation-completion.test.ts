import { describe, expect, it } from 'vitest';
import { createOperationCompletionTracker } from '../src/renderer/src/operation-completion';

describe('desktop operation completion tracker', () => {
  it('lets a replacement action wait until interrupted playback releases', async () => {
    const tracker = createOperationCompletionTracker();
    const complete = tracker.begin();
    let settled = false;
    const waiting = tracker.wait().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    complete();
    await waiting;
    expect(settled).toBe(true);
  });
});
