import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadPetPositionFile,
  savePetPositionFile,
} from '../src/shared/pet-position-file';

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
    expect(saved.width).toBe(128);
    expect(saved.height).toBe(128);
    expect(saved.version).toBe(3);
  });

  it('父目录不存在时自动创建', () => {
    const dir = tmpDir();
    const file = join(dir, 'nested', 'deep', 'pet-window.json');
    savePetPositionFile(file, { x: -5, y: 9, width: 128, height: 128 });
    expect(existsSync(file)).toBe(true);
  });

  it('restores a saved size and keeps version 2 positions compatible', () => {
    const dir = tmpDir();
    const file = join(dir, 'pet-window.json');
    savePetPositionFile(file, { x: 10, y: 20, width: 500, height: 240 });
    expect(loadPetPositionFile(file)).toEqual({
      x: 10,
      y: 20,
      width: 500,
      height: 240,
    });

    writeFileSync(file, JSON.stringify({ version: 2, x: 7, y: 8 }));
    expect(loadPetPositionFile(file)).toEqual({ x: 7, y: 8 });

    writeFileSync(file, JSON.stringify({ x: 10, y: 20 }));
    expect(loadPetPositionFile(file)).toBeNull();
  });
});
