import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Node Host boundary', () => {
  it('contains no shell, process execution, database or model provider access', () => {
    const source = readFileSync(
      new URL('./executor.ts', import.meta.url),
      'utf8',
    );
    for (const forbidden of [
      'child_process',
      'exec(',
      'spawn(',
      '@educanvas/db',
      '@educanvas/model-gateway',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
