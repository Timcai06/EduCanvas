import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('agent-runtime dependency boundary', () => {
  it('只依赖通用Agent契约，不依赖K12、Web、数据库或供应商SDK', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(packageJson.dependencies ?? {})).toEqual([
      '@educanvas/agent-core',
    ]);
  });
});
