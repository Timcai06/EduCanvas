import process from 'node:process';
import { renderBanner, renderRule } from './banner';
import { renderHome } from './home';
import { renderInputFrame, SLASH_COMMANDS } from './input-model';
import {
  renderApprovalCard,
  renderApprovalListItem,
  renderCitation,
  renderCompletion,
  renderFailure,
  renderProgressBar,
  renderToolCompleted,
  renderToolFailed,
  renderToolStarted,
} from './render';
import type { TuiTheme } from './theme';

/**
 * `educanvas ui-demo`：不连 Gateway 的界面全状态走查，供设计 QA 与
 * 终端兼容性检查使用。可用 EDUCANVAS_FORCE_COLOR=truecolor|ansi256|ansi16|none
 * 强制色深，检查渐变与无色降级；数据全部是显式虚构的示例。
 */
export function runUiDemo(theme: TuiTheme, width: number): void {
  const write = (value = '') => process.stdout.write(`${value}\n`);
  const section = (label: string) =>
    write(`\n${theme.dim('──')} ${theme.bold(label)} ${theme.dim('──')}\n`);

  section('产品首页');
  write(
    renderHome(theme, width, {
      gatewayUrl: 'http://127.0.0.1:3200',
      connected: true,
      notebooks: [
        { conversationId: 'demo-1', title: '分数运算（示例）' },
        { conversationId: 'demo-2', title: '光合作用（示例）' },
      ],
      activeConversationId: 'demo-1',
      pendingApprovals: 1,
    }),
  );

  section('输入框（空 / 输入中 / 斜杠补全）');
  const inputStates = [
    { value: '', cursor: 0, suggestions: [] as typeof SLASH_COMMANDS },
    { value: '为什么天空是蓝色的？', cursor: 10, suggestions: [] as typeof SLASH_COMMANDS },
    { value: '/app', cursor: 4, suggestions: SLASH_COMMANDS.filter((c) => c.name.startsWith('/app')) },
  ];
  for (const state of inputStates) {
    const frame = renderInputFrame(theme, width, {
      value: state.value,
      cursor: state.cursor,
      placeholder: '输入问题，/ 呼出命令',
      statusLine: '分数运算（示例） · ● 已连接 · 1 项待审批',
      suggestions: state.suggestions,
    });
    for (const line of frame.lines) write(line);
    write();
  }

  section('切换笔记本扉页');
  write(
    renderBanner(theme, width, {
      title: '分数运算（示例）',
      detailLines: ['12 条来源 · 3 件产物 · 上次学到「通分」', '直接输入问题开始对话 · /help 查看命令'],
    }),
  );

  section('问答与引用');
  write(`${theme.dai('✎')} 什么是分数的通分？`);
  write();
  write('通分就是把两个分母不同的分数，改写成分母相同的分数，');
  write('这样才能直接比较大小或相加减。关键是先找到两个分母的');
  write('最小公倍数 [1]。');
  write(renderCitation(theme, '《分数》第 2 节', 1));
  write(renderCompletion(theme, width, 3.2));

  section('Agent 行为（工具 / 产物进度）');
  write(renderToolStarted(theme, 'web_search'));
  write(renderToolCompleted(theme, 'web_search', 1.2));
  write(renderToolFailed(theme, 'web_page', true));
  write(renderProgressBar(theme, 0.35, '生成产物'));
  write(renderProgressBar(theme, 1, '生成产物') + ` ${theme.good('✓')}`);

  section('朱砂审批');
  write(
    renderApprovalCard(theme, width, {
      approvalId: 'approval-demo-1',
      capability: 'external_message',
      risk: 'l2',
      summary: '向家长微信发送本周学习摘要（发出后无法撤回）',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
  );
  write();
  write(
    renderApprovalListItem(theme, width, {
      approvalId: 'approval-demo-2',
      capability: 'device_read',
      risk: 'l3',
      summary: '读取家里电脑上的错题本文件夹',
      expiresAt: new Date().toISOString(),
    }),
  );

  section('失败与恢复');
  write(renderFailure(theme, 'RATE_LIMITED'));
  write(renderFailure(theme, 'UNAUTHENTICATED'));

  section('掌握时刻');
  write(`  ${theme.good('✓')} 「分数通分」已掌握 ${theme.seal('通')}`);

  section('窄终端扉页（40 列降级）');
  write(renderBanner(theme, 40, { title: '分数运算（示例）' }));

  write(renderRule(theme, width - 1));
  write(theme.dim('以上为 ui-demo 示例输出，未连接 Gateway。'));
}
