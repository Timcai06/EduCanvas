/**
 * 「两支笔」的终端配色语义。颜色永远只做冗余强调，含义必须同时由
 * 文字或符号承载——NO_COLOR、TERM=dumb 或重定向输出时全部纯文本降级。
 *
 *   黛青（dai）   = 讲课的笔：Agent 标识、链接、常规活动；
 *   朱砂（zhusha）= 批改的笔：审批、错误、需要用户注意的事；
 *   印章（seal）  = 实心朱砂块，仅用于品牌扉页与重要完成时刻。
 *
 * 色深分四档：truecolor → 256 色 → 16 色 → 无色。渐变只在前两档出现，
 * 低档位回落到单色，绝不输出终端不认识的序列。
 */

export type ColorDepth = 'none' | 'ansi16' | 'ansi256' | 'truecolor';

export interface TuiTheme {
  readonly enabled: boolean;
  readonly depth: ColorDepth;
  bold(value: string): string;
  dim(value: string): string;
  dai(value: string): string;
  zhusha(value: string): string;
  good(value: string): string;
  warn(value: string): string;
  /** 反白朱砂印章行；无色环境降级为【字】。 */
  seal(value: string): string;
  /** 实心朱砂背景行（扉页大印章的章面）；无色环境原样返回。 */
  sealBlock(value: string): string;
  /**
   * 墨色渐变：t ∈ [0,1] 从深黛到浅青。用于扉页字标的逐字/逐列上色；
   * 256 色取磁青梯度，16 色回落为普通黛青，无色原样返回。
   */
  daiGradient(value: string, t: number): string;
}

const ESC = '\u001b';
const wrap =
  (open: string, close: string) =>
  (value: string): string =>
    `${ESC}[${open}m${value}${ESC}[${close}m`;

const identity = (value: string): string => value;

export interface ThemeEnvironment {
  isTTY: boolean;
  noColor: boolean;
  term: string | undefined;
  colorterm: string | undefined;
  /** 显式覆盖色深（ui-demo/设计走查用），取值同 ColorDepth。 */
  forceDepth: string | undefined;
}

export function detectThemeEnvironment(
  stream: { isTTY?: boolean },
  env: Record<string, string | undefined>,
): ThemeEnvironment {
  return {
    isTTY: stream.isTTY === true,
    noColor: env.NO_COLOR !== undefined && env.NO_COLOR !== '',
    term: env.TERM,
    colorterm: env.COLORTERM,
    forceDepth: env.EDUCANVAS_FORCE_COLOR,
  };
}

export function resolveColorDepth(environment: ThemeEnvironment): ColorDepth {
  const forced = environment.forceDepth;
  if (forced === 'none' || forced === 'ansi16' || forced === 'ansi256' || forced === 'truecolor') {
    return forced;
  }
  if (!environment.isTTY || environment.noColor || environment.term === 'dumb') {
    return 'none';
  }
  if (
    environment.colorterm === 'truecolor' ||
    environment.colorterm === '24bit'
  ) {
    return 'truecolor';
  }
  if (environment.term?.includes('256color')) return 'ansi256';
  return 'ansi16';
}

/** 黛青渐变端点：深墨青 → 明磁青。中段亮度在亮/暗终端背景上都可读。 */
const DAI_GRADIENT_FROM = [22, 78, 92] as const;
const DAI_GRADIENT_TO = [92, 166, 180] as const;
/** 256 色近似梯度（xterm 立方体里的 teal 阶）。 */
const DAI_GRADIENT_256 = [23, 24, 30, 31, 37, 44] as const;

export function createTheme(environment: ThemeEnvironment): TuiTheme {
  const depth = resolveColorDepth(environment);
  if (depth === 'none') {
    return {
      enabled: false,
      depth,
      bold: identity,
      dim: identity,
      dai: identity,
      zhusha: identity,
      good: identity,
      warn: identity,
      seal: (value) => `【${value}】`,
      sealBlock: identity,
      daiGradient: identity as (value: string, t: number) => string,
    };
  }
  const daiGradient = (value: string, t: number): string => {
    const clamped = Math.min(1, Math.max(0, t));
    if (depth === 'truecolor') {
      const channel = (index: number) =>
        Math.round(
          DAI_GRADIENT_FROM[index]! +
            (DAI_GRADIENT_TO[index]! - DAI_GRADIENT_FROM[index]!) * clamped,
        );
      return `${ESC}[38;2;${channel(0)};${channel(1)};${channel(2)}m${value}${ESC}[39m`;
    }
    if (depth === 'ansi256') {
      const code =
        DAI_GRADIENT_256[
          Math.min(
            DAI_GRADIENT_256.length - 1,
            Math.floor(clamped * DAI_GRADIENT_256.length),
          )
        ]!;
      return `${ESC}[38;5;${code}m${value}${ESC}[39m`;
    }
    return wrap('36', '39')(value);
  };
  return {
    enabled: true,
    depth,
    bold: wrap('1', '22'),
    dim: wrap('2', '22'),
    dai: wrap('36', '39'),
    zhusha: wrap('31', '39'),
    good: wrap('32', '39'),
    warn: wrap('33', '39'),
    seal: (value) => `${ESC}[41;97m ${value} ${ESC}[0m`,
    sealBlock: (value) => `${ESC}[41;97;1m${value}${ESC}[0m`,
    daiGradient,
  };
}
