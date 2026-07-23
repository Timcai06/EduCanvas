import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('gateway-client dependency boundary', () => {
  it('does not import database, runtime, Next.js or provider implementations', () => {
    const source = readFileSync(
      new URL('./client.ts', import.meta.url),
      'utf8',
    );
    for (const forbidden of [
      '@educanvas/db',
      '@educanvas/agent-runtime',
      'next/',
      '@educanvas/model-gateway',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
