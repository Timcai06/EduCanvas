import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Telegram adapter boundary', () => {
  it('depends on Gateway contracts, not DB, Runtime or Telegram SDKs', () => {
    const source = readFileSync(
      new URL('./adapter.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('@educanvas/db');
    expect(source).not.toContain('@educanvas/agent-runtime');
    expect(source).not.toContain('node-telegram-bot-api');
    expect(source).not.toContain('telegraf');
  });
});
