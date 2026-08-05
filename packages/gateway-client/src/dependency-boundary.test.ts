import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('gateway-client dependency boundary', () => {
  // 防止客户端库越界到 db/runtime/next/provider 具体实现，确保它只承载 HTTP+schema 职责。
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
