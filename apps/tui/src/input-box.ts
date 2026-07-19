import { emitKeypressEvents, type Key } from 'node:readline';
import { stringWidth } from './text';
import {
  completeSlashCommand,
  matchSlashCommands,
  renderInputFrame,
} from './input-model';
import type { TuiTheme } from './theme';

/**
 * 终端 raw mode 输入框。视图逻辑全部来自 input-model 的纯函数，
 * 本类只负责按键循环、重绘与光标定位。提交后框体折叠为一行
 * `✎ 输入内容` 留在对话流里（Claude Code 式收纳）。
 *
 * 仅在 stdin/stdout 均为 TTY 时可用；调用方负责非 TTY 降级。
 */

export interface InputContext {
  placeholder: string;
  statusLine: string;
}

interface KeypressEvent {
  sequence?: string;
  key: Key | undefined;
}

const ESC = '\u001b';

export class InputBox {
  private history: string[] = [];

  constructor(
    private readonly theme: TuiTheme,
    private readonly stdin: NodeJS.ReadStream,
    private readonly out: NodeJS.WriteStream,
  ) {}

  /** 读取一行输入；返回 null 表示用户请求退出（Ctrl+C/Ctrl+D）。 */
  read(context: InputContext): Promise<string | null> {
    return new Promise((resolve) => {
      let value = '';
      let cursor = 0;
      let historyIndex = this.history.length;
      let renderedLines = 0;
      /* 上次 draw 后终端光标停在框内的行号（0 起），重绘定位以此为基准 */
      let lastCursorRow = 0;

      const frame = () =>
        renderInputFrame(this.theme, this.out.columns ?? 80, {
          value,
          cursor,
          placeholder: context.placeholder,
          statusLine: context.statusLine,
          suggestions: matchSlashCommands(value),
        });

      const draw = () => {
        const current = frame();
        if (renderedLines > 0 && lastCursorRow > 0) {
          this.out.write(`\r${ESC}[${lastCursorRow}A`);
        } else if (renderedLines > 0) {
          this.out.write('\r');
        }
        for (const line of current.lines) {
          this.out.write(`${ESC}[2K${line}\n`);
        }
        renderedLines = current.lines.length;
        /* 从框体下一行回到正文行的对应列（ANSI 列号 1 起） */
        const up = renderedLines - current.cursorRow;
        this.out.write(`${ESC}[${up}A${ESC}[${current.cursorCol + 1}G`);
        lastCursorRow = current.cursorRow;
      };

      const clearFrame = () => {
        if (renderedLines === 0) return;
        if (lastCursorRow > 0) this.out.write(`\r${ESC}[${lastCursorRow}A`);
        else this.out.write('\r');
        for (let index = 0; index < renderedLines; index += 1) {
          this.out.write(`${ESC}[2K`);
          if (index < renderedLines - 1) this.out.write(`${ESC}[1B`);
        }
        if (renderedLines > 1) this.out.write(`\r${ESC}[${renderedLines - 1}A`);
        renderedLines = 0;
        lastCursorRow = 0;
      };

      const finish = (result: string | null) => {
        this.stdin.off('keypress', onKeypress);
        this.out.off('resize', draw);
        if (this.stdin.isTTY) this.stdin.setRawMode(false);
        this.stdin.pause();
        clearFrame();
        if (result !== null && result.length > 0) {
          this.out.write(`${this.theme.dai('✎')} ${result}\n\n`);
          this.history.push(result);
        }
        resolve(result);
      };

      const insert = (text: string) => {
        const sanitized = text.replace(/[\r\n\t]+/g, ' ');
        const chars = [...value];
        chars.splice(cursor, 0, ...sanitized);
        value = chars.join('');
        cursor += [...sanitized].length;
      };

      const onKeypress = (_input: string | undefined, key: Key | undefined) => {
        const event: KeypressEvent = { sequence: key?.sequence, key };
        const name = event.key?.name;
        const ctrl = event.key?.ctrl === true;

        if (ctrl && (name === 'c' || name === 'd')) {
          if (name === 'c' && value.length > 0) {
            value = '';
            cursor = 0;
            draw();
            return;
          }
          finish(null);
          return;
        }
        if (name === 'return' || name === 'enter') {
          const trimmed = value.trim();
          if (trimmed.length === 0) return;
          finish(trimmed);
          return;
        }
        if (name === 'tab') {
          const completed = completeSlashCommand(value);
          if (completed !== null) {
            value = completed;
            cursor = [...value].length;
            draw();
          }
          return;
        }
        if (name === 'backspace') {
          if (cursor > 0) {
            const chars = [...value];
            chars.splice(cursor - 1, 1);
            value = chars.join('');
            cursor -= 1;
            draw();
          }
          return;
        }
        if (name === 'delete') {
          const chars = [...value];
          if (cursor < chars.length) {
            chars.splice(cursor, 1);
            value = chars.join('');
            draw();
          }
          return;
        }
        if (name === 'left') {
          cursor = Math.max(0, cursor - 1);
          draw();
          return;
        }
        if (name === 'right') {
          cursor = Math.min([...value].length, cursor + 1);
          draw();
          return;
        }
        if ((ctrl && name === 'a') || name === 'home') {
          cursor = 0;
          draw();
          return;
        }
        if ((ctrl && name === 'e') || name === 'end') {
          cursor = [...value].length;
          draw();
          return;
        }
        if (ctrl && name === 'u') {
          value = '';
          cursor = 0;
          draw();
          return;
        }
        if (name === 'escape') {
          value = '';
          cursor = 0;
          draw();
          return;
        }
        if (name === 'up') {
          if (historyIndex > 0) {
            historyIndex -= 1;
            value = this.history[historyIndex] ?? '';
            cursor = [...value].length;
            draw();
          }
          return;
        }
        if (name === 'down') {
          if (historyIndex < this.history.length) {
            historyIndex += 1;
            value = this.history[historyIndex] ?? '';
            cursor = [...value].length;
            draw();
          }
          return;
        }
        const sequence = event.sequence ?? '';
        if (
          sequence.length > 0 &&
          !ctrl &&
          event.key?.meta !== true &&
          stringWidth(sequence.replace(/[\r\n\t]/g, '')) > 0
        ) {
          insert(sequence);
          draw();
        }
      };

      emitKeypressEvents(this.stdin);
      if (this.stdin.isTTY) this.stdin.setRawMode(true);
      this.stdin.resume();
      this.stdin.on('keypress', onKeypress);
      this.out.on('resize', draw);
      draw();
    });
  }
}
