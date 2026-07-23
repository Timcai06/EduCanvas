import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Node app boundary', () => {
  it('has no database, model provider, shell or write capability handler', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    for (const forbidden of [
      '@educanvas/db',
      '@educanvas/model-gateway',
      'child_process',
      'exec(',
      'spawn(',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
