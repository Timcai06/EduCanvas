import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Node Runtime dependency boundary', () => {
  it('不依赖数据库、应用组合根或宿主机文件执行实现', async () => {
    const source = await readFile(
      new URL('./node-tool-adapters.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('@educanvas/db');
    expect(source).not.toContain('@educanvas/node-host');
    expect(source).not.toContain('node:fs');
    expect(source).not.toContain('node:child_process');
    expect(source).not.toContain('apps/');
  });
});
