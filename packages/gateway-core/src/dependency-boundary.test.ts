import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('gateway-core dependency boundary', () => {
  // Gateway 核心包必须最小依赖：仅保留纯协议与通用校验，不允许夹带 db/runtime/next 等实现层。
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
