import type { TuiTheme } from './theme';

export function renderCliUsage(): string {
  return [
    'EduCanvas TUI',
    '',
    '  educanvas                      交互式对话（推荐）',
    '  educanvas login <gateway-url> <user-id>',
    '  educanvas conversations',
    '  educanvas chat <conversation-id> <message...>',
    '  educanvas resume <operation-id> [after-sequence]',
    '  educanvas status <operation-id>',
    '  educanvas approvals',
    '  educanvas approve <approval-id> [reason]',
    '  educanvas deny <approval-id> [reason]',
    '  educanvas ui-demo              界面全状态走查（设计 QA）',
    '',
  ].join('\n');
}

/** /help：命令说明按用途分组，可发现性优先。 */
export function renderHelp(theme: TuiTheme): string {
  const row = (command: string, description: string) =>
    `  ${theme.dai(command.padEnd(18))}${theme.dim(description)}`;
  return [
    '',
    `${theme.bold('直接输入问题即可对话')}${theme.dim('，以下命令随时可用（Tab 可补全）：')}`,
    '',
    row('/notebooks', '列出全部笔记本'),
    row('/use <编号|id>', '切换笔记本'),
    row('/resume [编号]', '回看历史回答的完整过程'),
    row('/approvals', '查看待审批事项'),
    row('/approve [id]', '同意最近（或指定）的审批'),
    row('/deny [id]', '拒绝最近（或指定）的审批'),
    row('/channels', '列出、连接或撤销通信方式'),
    row('/canvas [编号]', '列出 Canvas 资源或安全交接到 Web'),
    row('/web', '在浏览器打开当前笔记本'),
    row('/help', '显示本说明'),
    row('/quit', '退出'),
    '',
  ].join('\n');
}
