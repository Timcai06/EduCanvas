import { afterEach, describe, expect, it, vi } from 'vitest';
import { PetSprite } from '../src/renderer/src/pet-sprite';
import type { PetManifest } from '../src/shared/pet-manifest';

const FRAME_W = 32;
const FRAME_H = 32;

function manifest(): PetManifest {
  return {
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
    fps: 10,
    anchor: { x: 64, y: 128 },
    states: {
      idle: { frames: [0, 1, 2, 3, 4, 5], fps: 10, loop: true },
      walk: { frames: [6, 7, 8], fps: 8, loop: true },
      think: { frames: [9], fps: 4, loop: false },
      speak: { frames: [10], fps: 4, loop: false },
      success: { frames: [11], fps: 4, loop: false },
      error: { frames: [12], fps: 4, loop: false },
    },
  };
}

interface DrawCall {
  sx: number;
  sy: number;
}

describe('PetSprite.draw 集成（manifest 帧 → 图片源坐标）', () => {
  const imageInstances: Array<{ naturalWidth: number }> = [];
  let calls: DrawCall[];
  let canvas: HTMLCanvasElement;

  class FakeImage {
    src = '';
    complete = true;
    naturalWidth = 0;
    constructor() {
      imageInstances.push(this);
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    imageInstances.length = 0;
    calls = [];
  });

  /** 真实图片列数（naturalWidth / frameWidth） */
  function sheetColsOf(naturalWidth: number): number {
    return Math.floor(naturalWidth / FRAME_W);
  }

  function setup(): void {
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('devicePixelRatio', 1);
    calls = [];
    const ctx = {
      imageSmoothingEnabled: true,
      clearRect: vi.fn(),
      drawImage: vi.fn(
        (
          _image: unknown,
          sx: number,
          sy: number,
          _sw: number,
          _sh: number,
          _dx: number,
          _dy: number,
          _dw: number,
          _dh: number,
        ) => {
          calls.push({ sx, sy });
        },
      ),
    };
    canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
  }

  /** 构造后模拟图片加载完成并设定实际尺寸 */
  function loadSheet(naturalWidth: number): void {
    imageInstances[0]!.naturalWidth = naturalWidth;
  }

  it('帧号合法时按帧索引取源坐标', () => {
    setup();
    const sprite = new PetSprite(canvas, manifest(), 'sheet.png');
    loadSheet(FRAME_W * 5); // 5 列图片
    sprite.draw('idle', 0); // elapsed=0，不推进，frameIndex=0 → 帧 0
    expect(calls[0]!.sx).toBe(0);

    sprite.draw('idle', 150); // 推进 1 步 → 帧 1
    expect(calls[1]!.sx).toBe(1 * FRAME_W);
  });

  it('manifest 帧号超出图片列数时钳到 0（失配兜底）', () => {
    setup();
    const sprite = new PetSprite(canvas, manifest(), 'sheet.png');
    loadSheet(FRAME_W * 3); // 图片只有 3 列
    // 推进到帧 5：nextFrameIndex 允许（frames 数组长度 6），
    // 但图片实际只有 3 列 → safeFrameIndex(5, 3) = 0
    sprite.draw('idle', 0);
    sprite.draw('idle', 1000); // elapsed=1000 → steps=10 → 大步数跳到帧 5
    expect(calls[1]!.sx).toBe(0);
    expect(sheetColsOf(FRAME_W * 3)).toBe(3);
  });

  it('非 idle 状态同样走钳制路径', () => {
    setup();
    const sprite = new PetSprite(canvas, manifest(), 'sheet.png');
    loadSheet(FRAME_W * 2); // 图片只有 2 列
    sprite.draw('walk', 0); // walk 帧 6 → safeFrameIndex(6, 2) = 0
    expect(calls[0]!.sx).toBe(0);
  });
});
