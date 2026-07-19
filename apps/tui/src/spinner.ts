/**
 * 墨点 spinner：盲文点阵旋转帧，写在同一行并用回车覆写。
 * 只在 TTY 上启用；非 TTY（管道、CI）下 start 静默降级为一次性输出，
 * 保证重定向日志里不会充满控制字符。
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const CLEAR_LINE = '\r\u001b[2K';

export interface SpinnerStream {
  isTTY?: boolean;
  write(chunk: string): unknown;
}

export class InkSpinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private text = '';

  constructor(private readonly stream: SpinnerStream) {}

  get active(): boolean {
    return this.timer !== null;
  }

  start(text: string): void {
    this.text = text;
    if (this.stream.isTTY !== true) {
      this.stream.write(`${text}\n`);
      return;
    }
    this.stop(null);
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % FRAMES.length;
      this.stream.write(`${CLEAR_LINE}${FRAMES[this.frameIndex]} ${this.text}`);
    }, 90);
    this.stream.write(`${CLEAR_LINE}${FRAMES[this.frameIndex]} ${this.text}`);
  }

  /** 停止并用 finalLine 覆写当前行；传 null 表示只清行不留痕。 */
  stop(finalLine: string | null): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.stream.write(CLEAR_LINE);
    }
    if (finalLine !== null) this.stream.write(`${finalLine}\n`);
  }
}
