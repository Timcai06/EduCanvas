import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESKTOP_PREFERENCES,
  parseDesktopPreferences,
} from '../src/renderer/src/desktop-preferences';

describe('desktop preferences', () => {
  it('loads valid audio and motion preferences', () => {
    expect(
      parseDesktopPreferences(
        JSON.stringify({
          muted: true,
          volume: 0.35,
          animationIntensity: 'off',
        }),
      ),
    ).toEqual({ muted: true, volume: 0.35, animationIntensity: 'off' });
  });

  it('clamps volume and fails closed to supported motion values', () => {
    expect(
      parseDesktopPreferences(
        JSON.stringify({ muted: 'yes', volume: 4, animationIntensity: 'wild' }),
      ),
    ).toEqual({ ...DEFAULT_DESKTOP_PREFERENCES, volume: 1 });
    expect(parseDesktopPreferences('{')).toEqual(DEFAULT_DESKTOP_PREFERENCES);
  });
});
