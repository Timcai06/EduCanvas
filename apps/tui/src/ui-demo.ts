import process from 'node:process';
import { renderBanner, renderRule } from './banner';
import {
  renderApprovalCard,
  renderApprovalListItem,
  renderCitation,
  renderCompletion,
  renderFailure,
  renderToolCompleted,
  renderToolFailed,
  renderToolStarted,
} from './render';
import type { TuiTheme } from './theme';

/**
 * `educanvas ui-demo`：不连 Gateway 的界面全状态走查，供设计 QA 与
 * 终端兼容性检查（宽窄终端、NO_COLOR、不同主题）使用。
 * 数据全部是显式虚构的示例，不代表任何真实会话。
 */
export function runUiDemo(theme: TuiTheme, width: number): void {
  const write = (value = '') => process.stdout.write(`${value}\n`);

  write(
    renderBanner(theme, width, {
      title: '分数运算（示例）',
      detailLines: ['直接输入问题开始对话', '/help 查看命令 · /web 打开网页端'],
    }),
  );

  write(`${theme.dai('✎')} 什么是分数的通分？`);
  write();
  write('通分就是把两个分母不同的分数，改写成分母相同的分数，');
  write('这样才能直接比较大小或相加减。关键是先找到两个分母的');
  write('最小公倍数 [1]。');
  write(renderCitation(theme, '《分数》第 2 节', 1));
  write();

  write(theme.dim('工具活动（进行中 → 完成 → 失败）：'));
  write(renderToolStarted(theme, 'web_search'));
  write(renderToolCompleted(theme, 'web_search', 1.2));
  write(renderToolFailed(theme, 'web_page', true));
  write();

  write(renderCompletion(theme, width, 3.2));
  write();

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
  write();

  write(theme.dim('失败与恢复：'));
  write(renderFailure(theme, 'RATE_LIMITED'));
  write(renderFailure(theme, 'UNAUTHENTICATED'));
  write();
  write(`${theme.good('✓')} 「分数通分」已掌握 ${theme.seal('通')}`);
  write();
  write(renderRule(theme, width - 1));
  write(theme.dim('以上为 ui-demo 示例输出，未连接 Gateway。'));
}
