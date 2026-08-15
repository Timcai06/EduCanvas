/**
 * 终端语义主题 — 颜色只允许通过语义 token 引用，禁止在渲染代码里散落裸 ANSI。
 *
 * 三档降级（按终端能力选择，见 ./capabilities.mjs）：
 * - sgr16：8 色基本集，兼容性最好，也是默认档（与历史输出逐字节兼容，
 *   parity 测试锁定 sgr16 档位颜色码）；
 * - sgr256：256 色（TERM 含 256color）；
 * - rgb：真彩色（COLORTERM=truecolor/24bit）。
 *
 * 颜色预算：1 品牌色 + success/warning/error + dim，禁止彩虹日志与
 * 每服务一个高饱和色。ANSI 只存在于展示层，绝不进入 JSONL。
 */

export const RESET = '\x1b[0m';

/** 语义 token → 各色深档位下的 ANSI 前缀（不含 RESET）。 */
export const TOKENS = {
  brand: {
    sgr16: '\x1b[34m',
    sgr256: '\x1b[38;5;75m',
    rgb: '\x1b[38;2;94;129;244m',
  },
  success: {
    sgr16: '\x1b[32m',
    sgr256: '\x1b[38;5;42m',
    rgb: '\x1b[38;2;80;200;120m',
  },
  warning: {
    sgr16: '\x1b[33m',
    sgr256: '\x1b[38;5;214m',
    rgb: '\x1b[38;2;255;184;77m',
  },
  error: {
    sgr16: '\x1b[31m',
    sgr256: '\x1b[38;5;203m',
    rgb: '\x1b[38;2;255;110;97m',
  },
  dim: {
    sgr16: '\x1b[2m',
    sgr256: '\x1b[2m',
    rgb: '\x1b[2m',
  },
};

export const DEPTHS = Object.freeze(['sgr16', 'sgr256', 'rgb']);

/** 取 token 在当前色深下的 ANSI 前缀；未知 token/档位返回空串（不抛错）。 */
export function ansiCode(token, depth = 'sgr16') {
  return TOKENS[token]?.[depth] ?? '';
}

/**
 * 用语义 token 上色。enabled=false（NO_COLOR/non-TTY/CI 静态模式）
 * 时原样返回文本，不带任何 ANSI。
 */
export function paint(token, text, { depth = 'sgr16', enabled = true } = {}) {
  const code = enabled ? ansiCode(token, depth) : '';
  return code === '' ? text : `${code}${text}${RESET}`;
}
