import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Node 侧边界检查：确保 app 层不引入数据库、模型网关、shell 能力。
 * 若引入这些模块，说明边界职责向外泄漏，需回滚并修正入口依赖。
 */
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
