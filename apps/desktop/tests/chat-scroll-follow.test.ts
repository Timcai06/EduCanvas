import { describe, expect, it } from 'vitest';
import { isChatHistoryNearBottom } from '../src/renderer/src/chat-scroll-follow';

describe('desktop chat scroll following', () => {
  it('continues following when the viewport remains near the latest message', () => {
    expect(
      isChatHistoryNearBottom({
        scrollHeight: 1_000,
        scrollTop: 570,
        clientHeight: 400,
      }),
    ).toBe(true);
  });

  it('preserves the reader position after they scroll away from the bottom', () => {
    expect(
      isChatHistoryNearBottom({
        scrollHeight: 1_000,
        scrollTop: 300,
        clientHeight: 400,
      }),
    ).toBe(false);
  });
});
