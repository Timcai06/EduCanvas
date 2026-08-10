import type { PetManifest } from '../../shared/pet-manifest';

/** 帧索引越界保护：非法索引钳到 0（manifest 与 sprite sheet 失配时兜底）。 */
export function safeFrameIndex(frame: number, totalFrames: number): number {
  return frame >= 0 && frame < totalFrames ? frame : 0;
}

/**
 * 推进帧索引。
 * frameIndex 为候选推进位置（已含步数，可跨多帧跳进）；current 兜底至少推进 1 步。
 * loop：越界回卷到 0；非 loop：越界停在最后一帧。
 */
export function nextFrameIndex(
  current: number,
  frameIndex: number,
  frames: number[],
  loop: boolean,
): number {
  const target = Math.max(frameIndex, current + 1);
  if (target >= frames.length) return loop ? 0 : frames.length - 1;
  return target;
}

/**
 * 桌宠 sprite 渲染器：按 manifest 的状态帧序列在 canvas 上绘制当前帧。
 * nearest-neighbor 整数倍缩放（像素风不糊），每状态按自身 fps 推进。
 */
export class PetSprite {
  private image: HTMLImageElement;
  private frameIndex = 0;
  private lastTick = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private manifest: PetManifest,
    sheetUrl: string,
  ) {
    this.image = new Image();
    this.image.src = sheetUrl;
  }

  /** 绘制指定状态的当前帧（按 manifest fps 推进）。 */
  draw(state: string, timeMs: number): void {
    const st = this.manifest.states[state];
    if (!st) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx || !this.image.complete) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(1, Math.round(dpr)); // 整数倍
    if (this.canvas.width !== 128 * scale) this.canvas.width = 128 * scale;
    if (this.canvas.height !== 128 * scale) this.canvas.height = 128 * scale;

    const elapsed = timeMs - this.lastTick;
    const interval = 1000 / st.fps;
    if (elapsed >= interval) {
      const steps = Math.floor(elapsed / interval);
      this.frameIndex = nextFrameIndex(
        this.frameIndex,
        this.frameIndex + steps,
        st.frames,
        st.loop,
      );
      this.lastTick = timeMs;
    }

    const frameIdx = this.frameIndex % st.frames.length;
    const src = st.frames[frameIdx] ?? 0;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(
      this.image,
      src * this.manifest.frameWidth,
      0,
      this.manifest.frameWidth,
      this.manifest.frameHeight,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
  }
}
