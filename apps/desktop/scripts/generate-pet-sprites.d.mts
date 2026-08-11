/** 生成脚本的类型声明（.mjs 无自带类型，测试 import 用）。 */

export interface PetManifestShape {
  frameWidth: number;
  frameHeight: number;
  fps: number;
  anchor: { x: number; y: number };
  states: Record<string, { frames: number[]; fps: number; loop: boolean }>;
}

export interface PetSpriteSheet {
  pngBuffer: Buffer;
  manifest: PetManifestShape;
}

/** 生成 11 帧 32×32 占位 sprite sheet + manifest（零依赖）。 */
export function createSpriteSheet(): PetSpriteSheet;
