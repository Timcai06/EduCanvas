import { describe, expect, it } from 'vitest';
import { EXPANDED_CHAT_WINDOW_OPTIONS } from '../src/shared/chat-window-layout';

describe('expanded desktop chat window', () => {
  it('opens as a hidden-first, resizable conversation window', () => {
    expect(EXPANDED_CHAT_WINDOW_OPTIONS).toMatchObject({
      width: 640,
      height: 680,
      minWidth: 420,
      minHeight: 420,
      resizable: true,
      show: false,
    });
  });
});
