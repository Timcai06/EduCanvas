import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOKENS, RESET, DEPTHS, ansiCode, paint } from './terminal/theme.mjs';
import { GLYPHS, SUMMARY_RULE } from './terminal/glyphs.mjs';
import { detectTerminalCapabilities } from './terminal/capabilities.mjs';
import {
  displayWidth,
  formatDuration,
  padDisplay,
  shortenPath,
  truncateDisplay,
} from './terminal/format.mjs';
import { hyperlink } from './terminal/links.mjs';
import { SPINNER_FRAMES, spinnerFrame } from './terminal/progress.mjs';

test('theme: sgr16 档位保持历史颜色码（parity 契约）', () => {
  assert.equal(TOKENS.dim.sgr16, '\x1b[2m');
  assert.equal(TOKENS.success.sgr16, '\x1b[32m');
  assert.equal(TOKENS.warning.sgr16, '\x1b[33m');
  assert.equal(TOKENS.error.sgr16, '\x1b[31m');
  assert.equal(TOKENS.brand.sgr16, '\x1b[34m');
});

test('theme: 高色深档位为独立 ANSI 前缀', () => {
  assert.equal(TOKENS.brand.sgr256, '\x1b[38;5;75m');
  assert.equal(TOKENS.brand.rgb, '\x1b[38;2;94;129;244m');
  assert.equal(TOKENS.dim.rgb, '\x1b[2m');
  assert.equal(RESET, '\x1b[0m');
  assert.ok(DEPTHS.includes('sgr16') && DEPTHS.includes('rgb'));
  assert.ok(Object.isFrozen(DEPTHS));
});

test('theme: ansiCode 对未知 token/档位返回空串', () => {
  assert.equal(ansiCode('missing', 'sgr16'), '');
  assert.equal(ansiCode('brand', 'unknown-depth'), '');
  assert.equal(ansiCode('success'), '\x1b[32m'); // 默认 sgr16
});

test('theme: paint 在 enabled=false 时原样返回', () => {
  assert.equal(paint('error', 'boom', { enabled: false }), 'boom');
  assert.equal(paint('error', 'boom'), '\x1b[31mboom\x1b[0m');
  assert.equal(
    paint('brand', 'x', { depth: 'rgb' }),
    '\x1b[38;2;94;129;244mx\x1b[0m',
  );
});

test('glyphs: 状态符号与摘要分隔线', () => {
  assert.equal(GLYPHS.brand, '◆');
  assert.equal(GLYPHS.ok, '✓');
  assert.equal(GLYPHS.fail, '×');
  assert.equal(GLYPHS.dot, '·');
  assert.equal(GLYPHS.chevron, '›');
  assert.equal(GLYPHS.indent, '↳');
  assert.equal(GLYPHS.branch, '│');
  assert.equal(GLYPHS.rule, '─');
  assert.equal(SUMMARY_RULE, '─'.repeat(56));
});

test('capabilities: 非 TTY 一律无颜色', () => {
  const caps = detectTerminalCapabilities({ stdout: {}, env: {} });
  assert.equal(caps.isTTY, false);
  assert.equal(caps.colorEnabled, false);
  assert.equal(caps.osc8, false);
});

test('capabilities: TTY + 无环境变量 → 彩色可用', () => {
  const caps = detectTerminalCapabilities({
    stdout: { isTTY: true, columns: 120 },
    env: {},
  });
  assert.equal(caps.isTTY, true);
  assert.equal(caps.colorEnabled, true);
  assert.equal(caps.osc8, true);
  assert.equal(caps.width, 120);
});

test('capabilities: NO_COLOR 非空禁用且优先于 FORCE_COLOR', () => {
  const tty = { isTTY: true };
  assert.equal(
    detectTerminalCapabilities({ stdout: tty, env: { NO_COLOR: '1' } })
      .colorEnabled,
    false,
  );
  assert.equal(
    detectTerminalCapabilities({
      stdout: tty,
      env: { NO_COLOR: '1', FORCE_COLOR: '1' },
    }).colorEnabled,
    false,
  );
  // 空字符串视为未设置（历史语义）。
  assert.equal(
    detectTerminalCapabilities({ stdout: tty, env: { NO_COLOR: '' } })
      .colorEnabled,
    true,
  );
});

test('capabilities: FORCE_COLOR=0 强制禁用', () => {
  const caps = detectTerminalCapabilities({
    stdout: { isTTY: true },
    env: { FORCE_COLOR: '0' },
  });
  assert.equal(caps.colorEnabled, false);
});

test('capabilities: 色深按 COLORTERM/TERM 探测', () => {
  assert.equal(
    detectTerminalCapabilities({ stdout: {}, env: { COLORTERM: 'truecolor' } })
      .colorDepth,
    'rgb',
  );
  assert.equal(
    detectTerminalCapabilities({ stdout: {}, env: { COLORTERM: '24bit' } })
      .colorDepth,
    'rgb',
  );
  assert.equal(
    detectTerminalCapabilities({ stdout: {}, env: { TERM: 'xterm-256color' } })
      .colorDepth,
    'sgr256',
  );
  assert.equal(
    detectTerminalCapabilities({ stdout: {}, env: {} }).colorDepth,
    'sgr16',
  );
});

test('capabilities: CI 与 dumb 终端识别', () => {
  assert.equal(
    detectTerminalCapabilities({ stdout: {}, env: { CI: '1' } }).isCI,
    true,
  );
  assert.equal(
    detectTerminalCapabilities({ stdout: {}, env: { CI: '' } }).isCI,
    false,
  );
  assert.equal(
    detectTerminalCapabilities({ stdout: {}, env: { TERM: 'dumb' } }).isDumb,
    true,
  );
  // 无 columns 时回退 80。
  assert.equal(detectTerminalCapabilities({ stdout: {}, env: {} }).width, 80);
});

test('format: displayWidth 中文按 2 格', () => {
  assert.equal(displayWidth('ab'), 2);
  assert.equal(displayWidth('中文'), 4);
  assert.equal(displayWidth('中a'), 3);
  assert.equal(displayWidth(''), 0);
});

test('format: padDisplay 按显示宽度填充', () => {
  assert.equal(padDisplay('a', 4), 'a   ');
  assert.equal(padDisplay('中文', 4), '中文');
  assert.equal(padDisplay('中文', 5), '中文 ');
  assert.equal(padDisplay('longer', 3), 'longer');
});

test('format: truncateDisplay 超宽以 … 结尾且不破坏中文', () => {
  assert.equal(truncateDisplay('中文abc', 5), '中文a…');
  assert.equal(truncateDisplay('short', 10), 'short');
  assert.equal(truncateDisplay('中', 1), '…');
});

test('format: formatDuration 人类可读时长', () => {
  assert.equal(formatDuration(43), '43ms');
  assert.equal(formatDuration(0), '0ms');
  assert.equal(formatDuration(840), '840ms'); // <1s 保持 ms
  assert.equal(formatDuration(8400), '8.40s');
  assert.equal(formatDuration(59_999), '60.00s');
  assert.equal(formatDuration(60_000), '1m 0s');
  assert.equal(formatDuration(90_500), '1m 31s');
  assert.equal(formatDuration(NaN), '');
  assert.equal(formatDuration(undefined), '');
});

test('format: shortenPath 仓库内相对、仓库外完整', () => {
  const cwd = '/repo/edu';
  assert.equal(
    shortenPath('/repo/edu/tmp/logs/local/x', { cwd }),
    'tmp/logs/local/x',
  );
  assert.equal(shortenPath('/repo/edu', { cwd }), '.');
  assert.equal(shortenPath('/elsewhere/tmp/x', { cwd }), '/elsewhere/tmp/x');
  // Windows 分隔符归一化。
  assert.equal(
    shortenPath('C:\\repo\\edu\\tmp\\logs', { cwd: 'C:/repo/edu' }),
    'tmp/logs',
  );
  assert.equal(shortenPath('', { cwd }), '');
});

test('links: OSC8 只在显式启用且 http/https 时输出', () => {
  assert.equal(
    hyperlink('web', 'http://127.0.0.1:3101', { enabled: true }),
    '\x1b]8;;http://127.0.0.1:3101\x1b\\web\x1b]8;;\x1b\\',
  );
  assert.equal(hyperlink('web', 'http://x', { enabled: false }), 'web');
  assert.equal(hyperlink('x', 'javascript:alert(1)', { enabled: true }), 'x');
  assert.equal(hyperlink('x', 'ftp://y', { enabled: true }), 'x');
  // 控制字符被净化，防止终端注入。
  assert.ok(
    !hyperlink('x', 'http://a\x1b]8;evil', { enabled: true }).includes(
      '\x1b]8;evil',
    ),
  );
});

test('progress: spinner 帧序列与取模安全', () => {
  assert.equal(SPINNER_FRAMES.length, 10);
  assert.equal(SPINNER_FRAMES[0], '⠋');
  assert.equal(spinnerFrame(0), '⠋');
  assert.equal(spinnerFrame(10), '⠋'); // 回绕
  assert.equal(spinnerFrame(-1), '⠙'); // 负数取绝对值
  assert.equal(spinnerFrame(3), '⠸');
});
