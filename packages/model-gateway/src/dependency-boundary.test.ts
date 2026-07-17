import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('model-gateway dependency boundary', () => {
  it('只依赖通用agent-core而不依赖K12教学包', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const dependencies = Object.keys(packageJson.dependencies ?? {});

    /* zod 是全仓基础校验库(agent-core 契约同源);禁的是 K12 与供应商 SDK */
    expect(dependencies).toEqual(['@educanvas/agent-core', 'zod']);
    expect(dependencies.some((name) => name.includes('teaching'))).toBe(false);
  });
});
