import type { BrowserWindowConstructorOptions } from 'electron';

/** Windows may expose the BrowserWindow default white surface before Chromium's first composited frame. */
export const PET_WINDOW_APPEARANCE = {
  transparent: true,
  backgroundColor: '#00000000',
  webPreferences: {
    // APNG frames must keep compositing while hidden; otherwise Chromium can expose a stale character frame on reveal.
    backgroundThrottling: false,
  },
} as const satisfies Pick<
  BrowserWindowConstructorOptions,
  'transparent' | 'backgroundColor' | 'webPreferences'
>;
