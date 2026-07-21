import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('gateway-runtime dependency boundary', () => {
  it('does not depend on Web, database, education or provider SDKs', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(packageJson.dependencies ?? {})).toEqual([
      '@educanvas/agent-core',
      '@educanvas/gateway-core',
    ]);
  });
});
