import type { TuiTheme } from './theme';
import { renderBanner } from './banner';
import { truncateToWidth } from './text';

/**
 * 产品首页：启动交互式 TUI 后、第一次输入前看到的画面。
 * 结构学习成熟 Agent CLI 的开屏（身份 → 连接状态 → 工作对象 → 上手提示），
 * 视觉沿用两支笔扉页；不展示任何未接通的能力。
 */

export interface HomeNotebook {
  conversationId: string;
  title: string | null;
}

export interface HomeInfo {
  gatewayUrl: string;
  connected: boolean;
  notebooks: readonly HomeNotebook[];
  activeConversationId: string | null;
  pendingApprovals: number;
}

export function renderHome(
  theme: TuiTheme,
  width: number,
  info: HomeInfo,
): string {
  const lines: string[] = [];
  const sectionMark = (label: string) =>
    ` ${theme.zhusha('▍')} ${theme.bold(label)}`;

  const connection = info.connected
    ? `${theme.good('●')} ${theme.dim(`Gateway 已连接 · ${info.gatewayUrl}`)}`
    : `${theme.zhusha('●')} ${theme.dim(`Gateway 未连接 · ${info.gatewayUrl}`)}`;
  const approvals =
    info.pendingApprovals > 0
      ? ` ${theme.zhusha(`· ${info.pendingApprovals} 项待审批`)}`
      : '';

  lines.push(
    renderBanner(theme, width, {
      title: '你的个人 AI 老师',
      detailLines: [],
    }),
  );
  lines.push(` ${connection}${approvals}`);
  lines.push('');

  lines.push(sectionMark('笔记本'));
  if (info.notebooks.length === 0) {
    lines.push(`   ${theme.dim('还没有笔记本，先在 Web 端创建一个（/web）')}`);
  } else {
    info.notebooks.slice(0, 6).forEach((notebook, index) => {
      const isActive = notebook.conversationId === info.activeConversationId;
      const marker = isActive ? theme.dai('●') : theme.dim('○');
      const title = truncateToWidth(
        notebook.title ?? '未命名笔记本',
        Math.max(10, width - 20),
      );
      lines.push(
        `   ${marker} ${theme.dim(`${index + 1}.`)} ${isActive ? theme.bold(title) : title}`,
      );
    });
    if (info.notebooks.length > 6) {
      lines.push(
        `   ${theme.dim(`… 共 ${info.notebooks.length} 个，/notebooks 查看全部`)}`,
      );
    }
  }
  lines.push('');

  lines.push(sectionMark('开始'));
  lines.push(`   ${theme.dim('直接输入问题，就会问当前笔记本的 AI 老师')}`);
  lines.push(
    `   ${theme.dim('输入 / 呼出命令 · Tab 补全 · /use 编号 切换笔记本 · /web 打开网页端')}`,
  );
  lines.push('');
  return lines.join('\n');
}
