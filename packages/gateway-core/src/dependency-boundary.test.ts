import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('gateway-core dependency boundary', () => {
  it('depends only on generic Agent contracts and Zod', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };

    expect(Object.keys(packageJson.dependencies ?? {})).toEqual([
      '@educanvas/agent-core',
      'zod',
    ]);
    const serialized = JSON.stringify(packageJson);
    expect(serialized).not.toContain('next');
    expect(serialized).not.toContain('drizzle');
    expect(serialized).not.toContain('teaching');
  });
});
