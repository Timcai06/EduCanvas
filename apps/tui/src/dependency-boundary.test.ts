import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('TUI dependency boundary', () => {
  it('talks through gateway-client without database or runtime imports', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('@educanvas/db');
    expect(source).not.toContain('@educanvas/agent-runtime');
    expect(source).not.toContain('@educanvas/model-gateway');
  });
});
