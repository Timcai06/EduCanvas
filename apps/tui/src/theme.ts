/**
 * 「两支笔」的终端配色语义。颜色永远只做冗余强调，含义必须同时由
 * 文字或符号承载——NO_COLOR、TERM=dumb 或重定向输出时全部纯文本降级。
 *
 *   黛青（dai）   = 讲课的笔：Agent 标识、链接、常规活动；
 *   朱砂（zhusha）= 批改的笔：审批、错误、需要用户注意的事；
 *   印章（seal）  = 反白朱砂块，仅用于品牌扉页与重要完成时刻。
 */

export interface TuiTheme {
  readonly enabled: boolean;
  bold(value: string): string;
  dim(value: string): string;
  dai(value: string): string;
  zhusha(value: string): string;
  good(value: string): string;
  warn(value: string): string;
  /** 反白朱砂印章块；无色环境降级为【字】。 */
  seal(value: string): string;
}

const wrap =
  (open: string, close: string) =>
  (value: string): string =>
    `\u001b[${open}m${value}\u001b[${close}m`;

const identity = (value: string): string => value;

export interface ThemeEnvironment {
  isTTY: boolean;
  noColor: boolean;
  term: string | undefined;
}

export function detectThemeEnvironment(
  stream: { isTTY?: boolean },
  env: Record<string, string | undefined>,
): ThemeEnvironment {
  return {
    isTTY: stream.isTTY === true,
    noColor: env.NO_COLOR !== undefined && env.NO_COLOR !== '',
    term: env.TERM,
  };
}

export function createTheme(environment: ThemeEnvironment): TuiTheme {
  const enabled =
    environment.isTTY && !environment.noColor && environment.term !== 'dumb';
  if (!enabled) {
    return {
      enabled,
      bold: identity,
      dim: identity,
      dai: identity,
      zhusha: identity,
      good: identity,
      warn: identity,
      seal: (value) => `【${value}】`,
    };
  }
  return {
    enabled,
    bold: wrap('1', '22'),
    dim: wrap('2', '22'),
    dai: wrap('36', '39'),
    zhusha: wrap('31', '39'),
    good: wrap('32', '39'),
    warn: wrap('33', '39'),
    seal: (value) => `\u001b[41;97m ${value} \u001b[0m`,
  };
}
