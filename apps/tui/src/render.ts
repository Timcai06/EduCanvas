import type { GatewayFailureCode } from '@educanvas/gateway-core';
import { padToWidth, stringWidth, truncateToWidth, wrapToWidth } from './text';
import type { TuiTheme } from './theme';

/**
 * 对话流中辅助层的纯渲染函数。三层信息密度里的第二层：
 * 工具活动、审批、引用、完成与失败都以单行或小卡片嵌入对话，
 * 不打断回答本身；颜色只做冗余强调，符号与文字才是语义载体。
 */

/** 已知工具的人话标签；未知工具显示原始 id，绝不伪装成已知能力。 */
const TOOL_LABELS: Record<string, string> = {
  web_search: '检索网页',
  web_page: '阅读网页',
  source_lookup: '查阅来源',
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

/* 工具行使用树形连接线：把 Agent 行为挂在回答的页边，与引用旁注(┊)同列。 */
export function renderToolStarted(theme: TuiTheme, tool: string): string {
  return theme.dim('  ├─ ') + theme.dai('⚙') + theme.dim(` ${toolLabel(tool)}…`);
}

export function renderToolCompleted(
  theme: TuiTheme,
  tool: string,
  seconds: number | null,
): string {
  const elapsed = seconds !== null ? ` · ${seconds.toFixed(1)}s` : '';
  return (
    theme.dim('  ├─ ') +
    theme.dai('⚙') +
    theme.dim(` ${toolLabel(tool)} `) +
    theme.good('✓') +
    theme.dim(elapsed)
  );
}

export function renderToolFailed(
  theme: TuiTheme,
  tool: string,
  retryable: boolean,
): string {
  const hint = retryable ? '（会自动重试）' : '';
  return (
    theme.dim('  ├─ ') +
    theme.dai('⚙') +
    theme.dim(` ${toolLabel(tool)} `) +
    theme.zhusha(`✗ 失败${hint}`)
  );
}

/** 产物生成进度：▰▰▰▱▱ 条 + 百分比，用于 artifact.generation_progress。 */
export function renderProgressBar(
  theme: TuiTheme,
  ratio: number,
  label: string,
  width = 14,
): string {
  const clamped = Math.min(1, Math.max(0, ratio));
  const filled = Math.round(clamped * width);
  const bar =
    theme.dai('▰'.repeat(filled)) + theme.dim('▱'.repeat(width - filled));
  const percent = `${Math.round(clamped * 100)}%`.padStart(4);
  return theme.dim('  ├─ ') + theme.dai('▣') + theme.dim(` ${label} `) + bar + theme.dim(percent);
}

/** 引用旁注：与 Web 端 marginalia 同语义；有注号时与正文 [n] 对应。 */
export function renderCitation(
  theme: TuiTheme,
  label: string,
  marker?: number,
): string {
  const markerText = marker !== undefined ? theme.dai(`[${marker}] `) : '';
  return theme.dim('  ┊ 引自 ') + markerText + theme.dai(label);
}

/** 完成落款线：`── ✓ 完成 · 3.2s ──…`，一条线收束一轮回答。 */
export function renderCompletion(
  theme: TuiTheme,
  width: number,
  seconds: number | null,
): string {
  const label = seconds !== null ? ` ✓ 完成 · ${seconds.toFixed(1)}s ` : ' ✓ 完成 ';
  const total = Math.max(20, Math.min(width, 72));
  const tail = Math.max(2, total - stringWidth(label) - 3);
  return theme.dim('── ') + theme.good('✓') + theme.dim(`${label.slice(2)}${'─'.repeat(tail)}`);
}

/** 失败码 → 人话。可恢复与不可恢复的措辞明确区分，不暴露内部术语。 */
export function failureMessage(code: GatewayFailureCode): {
  text: string;
  recoverable: boolean;
} {
  switch (code) {
    case 'RATE_LIMITED':
      return { text: '请求太频繁了，稍等片刻再发。', recoverable: true };
    case 'RUNTIME_FAILED':
      return { text: '这轮回答失败了，可以重新发送。', recoverable: true };
    case 'DELIVERY_FAILED':
      return { text: '回复投递失败，可以重新发送。', recoverable: true };
    case 'CANCELLED':
      return { text: '这轮回答已停止。', recoverable: true };
    case 'APPROVAL_DENIED':
      return { text: '你拒绝了本次操作，回答已停止。', recoverable: true };
    case 'UNAUTHENTICATED':
      return { text: '登录已过期，请重新运行 educanvas login。', recoverable: false };
    case 'FORBIDDEN':
      return { text: '当前账户没有权限执行这个操作。', recoverable: false };
    case 'CAPABILITY_UNAVAILABLE':
      return { text: '所需能力当前不可用（设备可能离线）。', recoverable: false };
    default:
      return { text: `出错了（${code}），可以稍后重试。`, recoverable: true };
  }
}

export function renderFailure(
  theme: TuiTheme,
  code: GatewayFailureCode,
): string {
  const { text, recoverable } = failureMessage(code);
  const mark = theme.zhusha('✗');
  const suffix = recoverable ? '' : theme.dim('（需要处理后才能继续）');
  return `\n${mark} ${text}${suffix}`;
}

export interface ApprovalCardInfo {
  approvalId: string;
  capability: string;
  risk: string;
  summary: string;
  expiresAt: string;
}

/**
 * 朱砂审批卡：对话流里唯一使用框线的对象——重线框（┏━┓）本身就是
 * 「请停下来看」。标题落在反白朱砂块上，操作行有明确按键提示。
 * 宽度自适应终端并按显示宽度对齐，CJK 混排不会画歪。
 */
export function renderApprovalCard(
  theme: TuiTheme,
  width: number,
  approval: ApprovalCardInfo,
): string {
  const cardWidth = Math.max(30, Math.min(width - 2, 62));
  const innerWidth = cardWidth - 4;
  const border = (value: string) => theme.zhusha(value);
  const headLabel = '需要你确认';
  const head = theme.enabled
    ? theme.seal(headLabel)
    : `【${headLabel}】`;
  /* 头行总宽 = ┏(1) + ━(1) + 章面 + 填充 + ┓(1)，与 body 行的 cardWidth 对齐；
     反白章面两侧各垫 1 空格(宽 2)，无色降级的全角【】共宽 4 */
  const headTail = Math.max(
    2,
    cardWidth - stringWidth(headLabel) - (theme.enabled ? 2 : 4) - 3,
  );
  const expires = new Date(approval.expiresAt);
  const expiresLabel = Number.isNaN(expires.getTime())
    ? approval.expiresAt
    : `${String(expires.getHours()).padStart(2, '0')}:${String(expires.getMinutes()).padStart(2, '0')}`;

  const bodyLines = [
    ...wrapToWidth(approval.summary, innerWidth),
    '',
    `能力 ${approval.capability} · 风险 ${approval.risk.toUpperCase()} · ${expiresLabel} 前有效`,
    `同意输入 /approve，拒绝输入 /deny`,
  ];
  const rows = bodyLines.flatMap((line) => wrapToWidth(line, innerWidth));

  return [
    border(`┏━`) + head + border(`${'━'.repeat(headTail)}┓`),
    ...rows.map(
      (line) => `${border('┃')} ${padToWidth(line, innerWidth)} ${border('┃')}`,
    ),
    border(`┗${'━'.repeat(cardWidth - 2)}┛`),
  ].join('\n');
}

/** 审批列表的单行摘要（/approvals）。 */
export function renderApprovalListItem(
  theme: TuiTheme,
  width: number,
  approval: ApprovalCardInfo,
): string {
  const summary = truncateToWidth(
    approval.summary,
    Math.max(10, width - 24),
  );
  return `${theme.zhusha('●')} ${summary} ${theme.dim(`· ${approval.risk.toUpperCase()} · ${approval.approvalId}`)}`;
}
