import { describe, expect, it } from 'vitest';

import config from '../electron.vite.config';

describe('desktop main bundle', () => {
  it('bundles workspace gateway dependencies so the packaged app starts standalone', () => {
    expect(config).not.toBeTypeOf('function');
    expect(
      (config as { main?: { build?: { externalizeDeps?: boolean } } }).main
        ?.build?.externalizeDeps,
    ).toBe(false);
  });
});
