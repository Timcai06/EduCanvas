import type { TuiTheme } from './theme';

/**
 * 流式 Markdown 终端着色器。逐字符状态机，跨 chunk 边界安全：
 * 标记（`、**、行首 #/-/>/```）可能被任意切分，因此绝不依赖整行到达。
 *
 * 设计取舍（诚实优先）：
 * - 只做行首结构（标题/列表/引用/围栏）与行内 ` 和 **；斜体、链接等
 *   歧义高的语法保持原样，不猜；
 * - 每个换行强制重置样式，未闭合的标记不会污染后续输出；
 * - 无色环境（theme.enabled=false）完全直通，保留原始 Markdown 字符。
 */

const ESC = '\u001b';
const BOLD_ON = `${ESC}[1m`;
const BOLD_OFF = `${ESC}[22m`;
const DIM_ON = `${ESC}[2m`;
const DIM_OFF = `${ESC}[22m`;
const DAI_ON = `${ESC}[36m`;
const DAI_OFF = `${ESC}[39m`;
const RESET = `${ESC}[0m`;

type LineMode = 'normal' | 'heading' | 'fence-content';

/** 行首缓冲仍可能长成结构前缀时返回 true（决定继续攒还是放行）。 */
function couldBePrefix(buffer: string): boolean {
  return (
    /^#{1,4}$/.test(buffer) ||
    /^`{1,3}$/.test(buffer) ||
    /^\d{1,2}\.?$/.test(buffer) ||
    buffer === '-' ||
    buffer === '*' ||
    buffer === '>'
  );
}

export class MarkdownStream {
  private atLineStart = true;
  private prefixBuffer = '';
  private fenceOpen = false;
  private lineMode: LineMode = 'normal';
  private bold = false;
  private code = false;
  private starPending = false;

  constructor(private readonly theme: TuiTheme) {}

  push(chunk: string): string {
    if (!this.theme.enabled) return chunk;
    let out = '';
    for (const char of chunk) out += this.pushChar(char);
    return out;
  }

  /** 回合结束：吐出所有悬挂状态（未定型的行首缓冲、孤立的 *）。 */
  flush(): string {
    if (!this.theme.enabled) return '';
    let out = '';
    if (this.prefixBuffer) {
      out += this.settlePrefix(null);
    }
    if (this.starPending) {
      out += '*';
      this.starPending = false;
    }
    if (this.bold || this.code || this.lineMode !== 'normal') out += RESET;
    this.bold = false;
    this.code = false;
    return out;
  }

  private pushChar(char: string): string {
    if (char === '\n') {
      let out = '';
      if (this.prefixBuffer) out += this.settlePrefix(null);
      if (this.starPending) {
        out += '*';
        this.starPending = false;
      }
      if (this.bold || this.code || this.lineMode !== 'normal') out += RESET;
      this.bold = false;
      this.code = false;
      this.lineMode = 'normal';
      this.atLineStart = true;
      this.prefixBuffer = '';
      return `${out}\n`;
    }

    if (this.atLineStart) {
      const candidate = this.prefixBuffer + char;
      if (couldBePrefix(candidate)) {
        this.prefixBuffer = candidate;
        return '';
      }
      return this.settlePrefix(char);
    }

    if (this.lineMode === 'fence-content') return char;
    return this.inlineChar(char);
  }

  /**
   * 行首缓冲定型：nextChar 是打破前缀模式的字符（null 表示行结束/flush）。
   * 返回应输出的内容，并根据结果切换行模式。
   */
  private settlePrefix(nextChar: string | null): string {
    const buffer = this.prefixBuffer;
    this.prefixBuffer = '';
    this.atLineStart = false;

    /* 围栏内：只有整行 ``` 是关栏，其余原样直通（含恰好以 ` 开头的代码） */
    if (this.fenceOpen) {
      this.lineMode = 'fence-content';
      if (buffer === '```' && (nextChar === null || nextChar === '\n')) {
        this.fenceOpen = false;
        this.lineMode = 'normal';
        return `${DIM_ON}\`\`\`${DIM_OFF}`;
      }
      return `${DIM_ON}${buffer}${nextChar ?? ''}`;
    }

    if (/^#{1,4}$/.test(buffer) && nextChar === ' ') {
      this.lineMode = 'heading';
      return `${DIM_ON}${buffer}${DIM_OFF} ${BOLD_ON}`;
    }
    if (buffer === '```') {
      /* 开栏；本行剩余是语言名，压暗 */
      this.fenceOpen = true;
      this.lineMode = 'fence-content';
      return `${DIM_ON}\`\`\`${nextChar ?? ''}`;
    }
    if ((buffer === '-' || buffer === '*') && nextChar === ' ') {
      return `${DAI_ON}•${DAI_OFF} `;
    }
    if (buffer === '>' && nextChar === ' ') {
      this.lineMode = 'fence-content'; /* 引用整行压暗，复用围栏行模式 */
      return `${DIM_ON}┃ `;
    }
    if (/^\d{1,2}\.$/.test(buffer) && nextChar === ' ') {
      return `${DAI_ON}${buffer}${DAI_OFF} `;
    }

    /* 不是结构前缀：缓冲逐字回放进行内处理 */
    let out = '';
    for (const bufferedChar of buffer) out += this.inlineChar(bufferedChar);
    if (nextChar !== null) out += this.inlineChar(nextChar);
    return out;
  }

  private inlineChar(char: string): string {
    if (this.starPending) {
      this.starPending = false;
      if (char === '*') {
        this.bold = !this.bold;
        return this.bold ? BOLD_ON : BOLD_OFF;
      }
      return `*${this.inlineChar(char)}`;
    }
    if (char === '*' && !this.code) {
      this.starPending = true;
      return '';
    }
    if (char === '`') {
      this.code = !this.code;
      return this.code ? DAI_ON : DAI_OFF;
    }
    return char;
  }
}
