import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savePetPositionFile } from '../src/shared/pet-position-file';

const dirs: string[] = [];

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'pet-pos-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('savePetPositionFile', () => {
  it('把窗口位置写入 JSON 文件', () => {
    const dir = tmpDir();
    const file = join(dir, 'pet-window.json');
    savePetPositionFile(file, { x: 100, y: 200, width: 128, height: 128 });
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(saved.x).toBe(100);
    expect(saved.y).toBe(200);
  });

  it('父目录不存在时自动创建', () => {
    const dir = tmpDir();
    const file = join(dir, 'nested', 'deep', 'pet-window.json');
    savePetPositionFile(file, { x: -5, y: 9, width: 128, height: 128 });
    expect(existsSync(file)).toBe(true);
  });
});
