import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Rect } from './pet-clamp';

/**
 * 桌宠位置落盘：hide 与真正退出（托盘「退出」）都会调用，保证拖走后直接退出
 * 下次启动仍恢复最后位置。目录不存在时自动创建；调用方负责吞掉失败。
 */
export function savePetPositionFile(posFile: string, bounds: Rect): void {
  mkdirSync(dirname(posFile), { recursive: true });
  writeFileSync(
    posFile,
    JSON.stringify({ version: 2, x: bounds.x, y: bounds.y }),
  );
}

export function loadPetPositionFile(
  posFile: string,
): { x: number; y: number } | null {
  try {
    const value = JSON.parse(readFileSync(posFile, 'utf8')) as Record<
      string,
      unknown
    >;
    return value.version === 2 &&
      typeof value.x === 'number' &&
      Number.isFinite(value.x) &&
      typeof value.y === 'number' &&
      Number.isFinite(value.y)
      ? { x: value.x, y: value.y }
      : null;
  } catch {
    return null;
  }
}
