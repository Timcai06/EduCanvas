import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Telegram composition root', () => {
  it('does not import Agent Runtime or provider adapters', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('@educanvas/agent-runtime');
    expect(source).not.toContain('@educanvas/model-gateway');
  });
});
