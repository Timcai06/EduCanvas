import { useEffect, useState } from 'react';

export type DesktopAnimationIntensity = 'system' | 'reduced' | 'off';

export interface DesktopPreferences {
  muted: boolean;
  volume: number;
  animationIntensity: DesktopAnimationIntensity;
}

export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  muted: false,
  volume: 0.8,
  animationIntensity: 'system',
};

export const DESKTOP_PREFERENCES_STORAGE_KEY =
  'educanvas.desktop.preferences.v1';

export function parseDesktopPreferences(
  raw: string | null,
): DesktopPreferences {
  if (!raw) return DEFAULT_DESKTOP_PREFERENCES;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const volume =
      typeof value.volume === 'number' && Number.isFinite(value.volume)
        ? Math.min(1, Math.max(0, value.volume))
        : DEFAULT_DESKTOP_PREFERENCES.volume;
    const animationIntensity = ['system', 'reduced', 'off'].includes(
      String(value.animationIntensity),
    )
      ? (value.animationIntensity as DesktopAnimationIntensity)
      : DEFAULT_DESKTOP_PREFERENCES.animationIntensity;
    return {
      muted:
        typeof value.muted === 'boolean'
          ? value.muted
          : DEFAULT_DESKTOP_PREFERENCES.muted,
      volume,
      animationIntensity,
    };
  } catch {
    return DEFAULT_DESKTOP_PREFERENCES;
  }
}

export function useDesktopPreferences(): {
  preferences: DesktopPreferences;
  updatePreferences(update: Partial<DesktopPreferences>): void;
} {
  const [preferences, setPreferences] = useState(DEFAULT_DESKTOP_PREFERENCES);

  useEffect(() => {
    const accept = (raw: string | null): void =>
      setPreferences(parseDesktopPreferences(raw));
    try {
      accept(window.localStorage.getItem(DESKTOP_PREFERENCES_STORAGE_KEY));
    } catch {
      accept(null);
    }
    const onStorage = (event: StorageEvent): void => {
      if (event.key === DESKTOP_PREFERENCES_STORAGE_KEY) accept(event.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const updatePreferences = (update: Partial<DesktopPreferences>): void => {
    setPreferences((current) => {
      const next = parseDesktopPreferences(
        JSON.stringify({ ...current, ...update }),
      );
      try {
        window.localStorage.setItem(
          DESKTOP_PREFERENCES_STORAGE_KEY,
          JSON.stringify(next),
        );
      } catch {
        // Storage may be unavailable; keep the preference for this session.
      }
      return next;
    });
  };

  return { preferences, updatePreferences };
}
