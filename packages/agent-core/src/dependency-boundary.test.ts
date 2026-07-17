import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('agent-core dependency boundary', () => {
  it('不依赖教学、Web、数据库或供应商SDK', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const dependencies = Object.keys(packageJson.dependencies ?? {});

    expect(dependencies).toEqual(['zod']);
    expect(dependencies.some((name) => name.includes('teaching'))).toBe(false);
    expect(dependencies.some((name) => name.includes('next'))).toBe(false);
    expect(dependencies.some((name) => name.includes('drizzle'))).toBe(false);
  });
});
