import { describe, expect, it } from 'vitest';
import { renderBanner } from './banner';
import {
  failureMessage,
  renderApprovalCard,
  renderCompletion,
  renderToolCompleted,
  toolLabel,
} from './render';
import { stringWidth, stripAnsi } from './text';
import { createTheme } from './theme';

const color = createTheme({ isTTY: true, noColor: false, term: 'xterm' });
const plain = createTheme({ isTTY: false, noColor: true, term: undefined });

describe('theme degradation', () => {
  it('emits no escape codes when colors are unavailable', () => {
    expect(plain.zhusha('批')).toBe('批');
    expect(plain.seal('通')).toBe('【通】');
  });

  it('meaning never depends on color alone', () => {
    /* 同意/拒绝/失败均有符号与文字冗余;去色后文本仍可区分 */
    expect(stripAnsi(renderToolCompleted(color, 'web_search', 1.2))).toContain(
      '✓',
    );
  });
});

describe('approval card', () => {
  const approval = {
    approvalId: 'approval-1',
    capability: 'external_message',
    risk: 'l2',
    summary: '向家长微信发送本周学习摘要（发出后无法撤回）',
    expiresAt: '2026-07-19T13:30:00.000+08:00',
  };

  it('keeps every row at identical display width despite CJK', () => {
    const lines = stripAnsi(renderApprovalCard(color, 80, approval)).split('\n');
    const widths = lines.map(stringWidth);
    expect(new Set(widths).size).toBe(1);
  });

  it('adapts to narrow terminals without breaking the frame', () => {
    const lines = stripAnsi(renderApprovalCard(plain, 34, approval)).split('\n');
    expect(lines[0]!.startsWith('╭')).toBe(true);
    expect(lines.at(-1)!.startsWith('╰')).toBe(true);
    expect(Math.max(...lines.map(stringWidth))).toBeLessThanOrEqual(34);
  });

  it('tells the user how to respond', () => {
    const card = stripAnsi(renderApprovalCard(plain, 80, approval));
    expect(card).toContain('/approve');
    expect(card).toContain('/deny');
  });
});

describe('banner', () => {
  it('renders the seal banner on wide terminals', () => {
    const banner = stripAnsi(
      renderBanner(color, 90, { title: '分数运算', detailLines: ['提示'] }),
    );
    expect(banner).toContain('EduCanvas');
    expect(banner).toContain('分数运算');
    expect(banner).toContain('▛▀▀▀▜');
  });

  it('drops decoration before information on narrow terminals', () => {
    const banner = stripAnsi(renderBanner(color, 40, { title: '分数运算' }));
    expect(banner).not.toContain('▛');
    expect(banner).toContain('EduCanvas');
    for (const line of banner.split('\n')) {
      expect(stringWidth(line)).toBeLessThanOrEqual(40);
    }
  });
});

describe('failure vocabulary', () => {
  it('distinguishes recoverable from unrecoverable failures', () => {
    expect(failureMessage('RATE_LIMITED').recoverable).toBe(true);
    expect(failureMessage('UNAUTHENTICATED').recoverable).toBe(false);
  });

  it('falls back to the raw id for unknown tools instead of pretending', () => {
    expect(toolLabel('unknown_tool')).toBe('unknown_tool');
    expect(toolLabel('web_search')).toBe('检索网页');
  });
});

describe('completion rule', () => {
  it('stays within terminal width', () => {
    expect(stringWidth(stripAnsi(renderCompletion(color, 60, 3.2)))).toBeLessThanOrEqual(
      60,
    );
  });
});
