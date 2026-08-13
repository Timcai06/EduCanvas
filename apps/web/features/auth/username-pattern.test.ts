import { describe, expect, it } from 'vitest';
import { USERNAME_HTML_PATTERN } from './username-pattern';

describe('username HTML pattern', () => {
  it('is valid under the Unicode Sets mode used by browsers', () => {
    const browserPattern = new RegExp(`^(?:${USERNAME_HTML_PATTERN})$`, 'v');
    expect(browserPattern.test('alice_01')).toBe(true);
    expect(browserPattern.test('alice-01')).toBe(true);
    expect(browserPattern.test('_alice')).toBe(false);
  });
});
