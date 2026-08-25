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
    JSON.stringify({
      version: 3,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    }),
  );
}

export function loadPetPositionFile(
  posFile: string,
): { x: number; y: number; width?: number; height?: number } | null {
  try {
    const value = JSON.parse(readFileSync(posFile, 'utf8')) as Record<
      string,
      unknown
    >;
    const positionValid =
      typeof value.x === 'number' &&
      Number.isFinite(value.x) &&
      typeof value.y === 'number' &&
      Number.isFinite(value.y);
    if (!positionValid) return null;
    if (value.version === 2)
      return { x: value.x as number, y: value.y as number };
    const sizeValid =
      value.version === 3 &&
      typeof value.width === 'number' &&
      Number.isFinite(value.width) &&
      value.width > 0 &&
      typeof value.height === 'number' &&
      Number.isFinite(value.height) &&
      value.height > 0;
    return sizeValid
      ? {
          x: value.x as number,
          y: value.y as number,
          width: value.width as number,
          height: value.height as number,
        }
      : null;
  } catch {
    return null;
  }
}
