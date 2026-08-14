import { describe, expect, it } from 'vitest';
import {
  decodeConversationDirectoryCursor,
  encodeConversationDirectoryCursor,
} from './conversation-directory-cursor';

describe('conversation directory cursor', () => {
  it('round-trips the stable activity/id position', () => {
    const value = {
      lastActivityAt: new Date('2026-08-13T07:00:00.000Z'),
      conversationId: 'conversation:one',
    };
    expect(
      decodeConversationDirectoryCursor(
        encodeConversationDirectoryCursor(value),
      ),
    ).toEqual(value);
  });

  it('rejects malformed, extra-field and non-canonical cursors', () => {
    for (const cursor of [
      'bad',
      `gdc1.${Buffer.from(JSON.stringify({ t: 'bad', i: 'conversation:one' })).toString('base64url')}`,
      `gdc1.${Buffer.from(JSON.stringify({ t: '2026-08-13T07:00:00.000Z', i: 'conversation:one', userId: 'user:one' })).toString('base64url')}`,
    ]) {
      expect(decodeConversationDirectoryCursor(cursor)).toBeNull();
    }
  });
});
