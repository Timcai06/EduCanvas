#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { emitKeypressEvents, type Key } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import {
  GatewayBootstrapClient,
  type GatewayConversationEntry,
} from '@educanvas/gateway-client';
import { renderBanner, renderRule } from './banner';
import { saveConfig } from './config';
import { renderHome } from './home';
import { InputBox } from './input-box';
import {
  renderApprovalCard,
  renderApprovalListItem,
} from './render';
import { TurnRenderer, type RendererIO } from './renderer';
import { runUiDemo } from './ui-demo';
import { establishGatewaySession } from './session';
import { createTheme, detectThemeEnvironment, type TuiTheme } from './theme';

function usage(): never {
  process.stderr.write(`EduCanvas TUI\n\n`);
  process.stderr.write(`  educanvas                      交互式对话（推荐）\n`);
  process.stderr.write(`  educanvas login <gateway-url> <user-id>\n`);
  process.stderr.write(`  educanvas conversations\n`);
  process.stderr.write(`  educanvas chat <conversation-id> <message...>\n`);
  process.stderr.write(`  educanvas resume <operation-id> [after-sequence]\n`);
  process.stderr.write(`  educanvas status <operation-id>\n`);
  process.stderr.write(`  educanvas approvals\n`);
  process.stderr.write(`  educanvas approve <approval-id> [reason]\n`);
  process.stderr.write(`  educanvas deny <approval-id> [reason]\n`);
  process.stderr.write(`  educanvas ui-demo              界面全状态走查（设计 QA）\n`);
  process.exit(2);
}

function openWeb(url: string): void {
  const invocation =
    process.platform === 'darwin'
      ? (['open', [url]] as const)
      : process.platform === 'win32'
        ? (['cmd', ['/c', 'start', '', url]] as const)
        : (['xdg-open', [url]] as const);
  const child = spawn(invocation[0], [...invocation[1]], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function terminalWidth(): number {
  return process.stdout.columns ?? 80;
}

function makeIO(): RendererIO {
  return { out: process.stdout, err: process.stderr, width: terminalWidth };
}

function findConversation(
  conversations: readonly GatewayConversationEntry[],
  id: string,
): GatewayConversationEntry {
  const conversation = conversations.find((item) => item.conversationId === id);
  if (!conversation) throw new Error('这个笔记本不存在或没有访问权限');
  return conversation;
}

/** /help：命令说明按用途分组，可发现性优先。 */
function renderHelp(theme: TuiTheme): string {
  const row = (command: string, description: string) =>
    `  ${theme.dai(command.padEnd(18))}${theme.dim(description)}`;
  return [
    '',
    `${theme.bold('直接输入问题即可对话')}${theme.dim('，以下命令随时可用（Tab 可补全）：')}`,
    '',
    row('/notebooks', '列出全部笔记本'),
    row('/use <编号|id>', '切换笔记本'),
    row('/approvals', '查看待审批事项'),
    row('/approve [id]', '同意最近（或指定）的审批'),
    row('/deny [id]', '拒绝最近（或指定）的审批'),
    row('/web', '在浏览器打开 Web 端'),
    row('/help', '显示本说明'),
    row('/quit', '退出'),
    '',
  ].join('\n');
}

function notebookLine(
  theme: TuiTheme,
  conversation: GatewayConversationEntry,
  index: number,
  isActive: boolean,
): string {
  const marker = isActive ? theme.dai('●') : theme.dim('○');
  const title = conversation.title ?? '未命名笔记本';
  const name = isActive ? theme.bold(title) : title;
  return `  ${marker} ${theme.dim(`${index + 1}.`)} ${name} ${theme.dim(conversation.conversationId)}`;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const theme = createTheme(
    detectThemeEnvironment(process.stderr, process.env),
  );

  if (command === 'ui-demo') {
    runUiDemo(theme, terminalWidth());
    return;
  }

  if (command === 'login') {
    const [baseUrl, userId] = args;
    const bootstrapToken = process.env.EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN;
    if (!baseUrl || !userId || !bootstrapToken) {
      throw new Error(
        'login requires URL, user ID and EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN',
      );
    }
    const session = await new GatewayBootstrapClient(baseUrl).bootstrap(
      userId,
      bootstrapToken,
    );
    await saveConfig({
      baseUrl,
      userId: session.userId,
      token: session.token,
      expiresAt: session.expiresAt,
    });
    process.stdout.write(
      `${theme.good('✓')} 已登录 ${session.userId}，有效期至 ${session.expiresAt}\n`,
    );
    return;
  }

  const baseUrl =
    process.env.EDUCANVAS_GATEWAY_URL?.trim() || 'http://127.0.0.1:3200';
  const { client, conversations: initialConversations } =
    await establishGatewaySession(baseUrl);

  if (!command) {
    const conversations = [...initialConversations];
    let current = conversations[0];
    if (!current) throw new Error('当前账户没有可访问的笔记本');
    let lastApprovalId: string | null = null;
    let approvalsCount = 0;
    try {
      approvalsCount = (await client.listApprovals()).length;
    } catch {
      /* 首页的待审批数是提示性信息，取不到不阻塞进入 */
    }

    process.stdout.write(
      renderHome(theme, terminalWidth(), {
        gatewayUrl: baseUrl,
        connected: true,
        notebooks: conversations,
        activeConversationId: current.conversationId,
        pendingApprovals: approvalsCount,
      }),
    );

    const statusText = () =>
      `${current!.title ?? '未命名笔记本'} · ● 已连接${
        approvalsCount > 0 ? ` · ${approvalsCount} 项待审批` : ''
      }`;

    const interactiveTTY =
      process.stdin.isTTY === true && process.stdout.isTTY === true;
    const inputBox = interactiveTTY
      ? new InputBox(theme, process.stdin, process.stdout)
      : null;
    const fallbackReadline = interactiveTTY
      ? null
      : createInterface({ input: process.stdin, output: process.stdout });

    const readLine = async (): Promise<string | null> => {
      if (inputBox) {
        return inputBox.read({
          placeholder: '输入问题，/ 呼出命令',
          statusLine: statusText(),
        });
      }
      try {
        return (await fallbackReadline!.question('✎ ')).trim();
      } catch {
        return null;
      }
    };

    const resolveApprovalTarget = (argument: string | undefined): string | null =>
      argument?.trim() || lastApprovalId;

    try {
      while (true) {
        const line = await readLine();
        if (line === null) break;
        if (!line) continue;
        if (line === '/quit' || line === '/exit') break;
        if (line === '/help') {
          process.stdout.write(renderHelp(theme));
          continue;
        }
        if (line === '/notebooks') {
          process.stdout.write('\n');
          conversations.forEach((conversation, index) => {
            process.stdout.write(
              `${notebookLine(theme, conversation, index, conversation.conversationId === current!.conversationId)}\n`,
            );
          });
          process.stdout.write(
            `${theme.dim('  /use <编号或 id> 切换')}\n\n`,
          );
          continue;
        }
        if (line.startsWith('/use ')) {
          const target = line.slice(5).trim();
          const byIndex = /^\d+$/.test(target)
            ? conversations[Number(target) - 1]
            : undefined;
          try {
            current = byIndex ?? findConversation(conversations, target);
            process.stdout.write(
              renderBanner(theme, terminalWidth(), {
                title: current.title,
                detailLines: ['已切换，直接输入问题继续'],
              }) + '\n',
            );
          } catch (error) {
            process.stderr.write(
              `${theme.zhusha('✗')} ${error instanceof Error ? error.message : '切换失败'}\n`,
            );
          }
          continue;
        }
        if (line === '/approvals') {
          const approvals = await client.listApprovals();
          approvalsCount = approvals.length;
          if (approvals.length === 0) {
            process.stdout.write(`${theme.dim('没有待处理的审批。')}\n\n`);
            continue;
          }
          process.stdout.write('\n');
          for (const approval of approvals) {
            process.stdout.write(
              `${renderApprovalListItem(theme, terminalWidth(), approval)}\n`,
            );
            lastApprovalId = approval.approvalId;
          }
          process.stdout.write(
            `${theme.dim('  /approve [id] 同意 · /deny [id] 拒绝（缺省针对最近一条）')}\n\n`,
          );
          continue;
        }
        if (line === '/approve' || line.startsWith('/approve ') ||
            line === '/deny' || line.startsWith('/deny ')) {
          const isApprove = line === '/approve' || line.startsWith('/approve ');
          const argument = line.split(/\s+/)[1];
          const target = resolveApprovalTarget(argument);
          if (!target) {
            process.stderr.write(
              `${theme.warn('!')} 没有可处理的审批。先用 /approvals 查看。\n`,
            );
            continue;
          }
          try {
            await client.resolveApproval(
              target,
              isApprove ? 'approved' : 'denied',
              undefined,
            );
            process.stdout.write(
              isApprove
                ? `${theme.good('✓')} 已同意 ${theme.dim(target)}\n\n`
                : `${theme.zhusha('✗')} 已拒绝 ${theme.dim(target)}\n\n`,
            );
            if (lastApprovalId === target) lastApprovalId = null;
            approvalsCount = Math.max(0, approvalsCount - 1);
          } catch (error) {
            process.stderr.write(
              `${theme.zhusha('✗')} 处理失败：${error instanceof Error ? error.message : '未知错误'}\n`,
            );
          }
          continue;
        }
        if (line === '/web') {
          const webUrl =
            process.env.EDUCANVAS_WEB_URL?.trim() || 'http://127.0.0.1:3101';
          openWeb(webUrl);
          process.stdout.write(`${theme.dim(`已在浏览器打开 ${webUrl}`)}\n\n`);
          continue;
        }
        if (line.startsWith('/')) {
          process.stderr.write(
            `${theme.warn('!')} 未知命令 ${line.split(/\s+/)[0]}，/help 查看全部命令。\n`,
          );
          continue;
        }

        const turnRenderer = new TurnRenderer(theme, makeIO());
        /* Esc 只离开实时视图：Gateway 没有取消端点，操作会在后台完成，
           这里绝不把"不看了"伪装成"已停止"。 */
        const abort = new AbortController();
        const rawCapable = process.stdin.isTTY === true;
        const onStreamKey = (_input: string | undefined, key: Key | undefined) => {
          if (key?.name === 'escape' || (key?.ctrl === true && key.name === 'c')) {
            abort.abort();
          }
        };
        if (rawCapable) {
          emitKeypressEvents(process.stdin);
          process.stdin.setRawMode(true);
          process.stdin.resume();
          process.stdin.on('keypress', onStreamKey);
        }
        try {
          for await (const event of client.streamTurn(
            {
              clientMessageId: `tui:${randomUUID()}`,
              notebookId: current.notebookId,
              conversationId: current.conversationId,
              parts: [{ type: 'text', text: line }],
            },
            { signal: abort.signal },
          ))
            turnRenderer.render(event);
        } catch (error) {
          if (abort.signal.aborted) {
            const resumeHint = turnRenderer.operationId
              ? ` · educanvas resume ${turnRenderer.operationId} 可回看`
              : '';
            process.stderr.write(
              `\n${theme.dim(`── 已离开这轮回答的实时视图，AI 老师仍在后台完成它${resumeHint} ──`)}\n`,
            );
          } else {
            process.stderr.write(
              `\n${theme.zhusha('✗')} 连接中断：${error instanceof Error ? error.message : '未知错误'}${theme.dim('（消息未丢失，可用 educanvas resume 恢复）')}\n`,
            );
          }
        } finally {
          if (rawCapable) {
            process.stdin.off('keypress', onStreamKey);
            process.stdin.setRawMode(false);
            process.stdin.pause();
          }
        }
        for (const approvalEvent of turnRenderer.pendingApprovals) {
          if (approvalEvent.type === 'approval.required') {
            lastApprovalId = approvalEvent.approval.approvalId;
            approvalsCount += 1;
          }
        }
        process.stdout.write('\n');
      }
    } finally {
      fallbackReadline?.close();
      process.stdout.write(`${theme.dim('下次见。')}\n`);
    }
    return;
  }

  if (command === 'conversations') {
    for (const conversation of initialConversations) {
      process.stdout.write(
        `${conversation.conversationId}\t${conversation.membershipRole}\t${conversation.title ?? 'Untitled'}\n`,
      );
    }
    return;
  }
  if (command === 'chat') {
    const [conversationId, ...messageParts] = args;
    const message = messageParts.join(' ').trim();
    if (!conversationId || !message) usage();
    const conversation = findConversation(initialConversations, conversationId);
    const turnRenderer = new TurnRenderer(theme, makeIO());
    for await (const event of client.streamTurn({
      clientMessageId: `tui:${randomUUID()}`,
      notebookId: conversation.notebookId,
      conversationId: conversation.conversationId,
      parts: [{ type: 'text', text: message }],
    }))
      turnRenderer.render(event);
    return;
  }
  if (command === 'approvals') {
    const approvals = await client.listApprovals();
    if (approvals.length === 0) {
      process.stdout.write(`${theme.dim('没有待处理的审批。')}\n`);
      return;
    }
    for (const approval of approvals) {
      process.stdout.write(
        `${renderApprovalCard(theme, terminalWidth(), approval)}\n`,
      );
    }
    return;
  }
  if (command === 'approve' || command === 'deny') {
    const [approvalId, ...reasonParts] = args;
    if (!approvalId) usage();
    await client.resolveApproval(
      approvalId,
      command === 'approve' ? 'approved' : 'denied',
      reasonParts.join(' ').trim() || undefined,
    );
    process.stdout.write(
      command === 'approve'
        ? `${theme.good('✓')} 已同意 ${approvalId}\n`
        : `${theme.zhusha('✗')} 已拒绝 ${approvalId}\n`,
    );
    return;
  }
  if (command === 'resume' || command === 'status') {
    const operationId = args[0];
    if (!operationId) usage();
    const after = command === 'resume' ? Number(args[1] ?? '-1') : -1;
    const events = await client.resume(operationId, after);
    if (command === 'status') {
      const final = events.at(-1);
      process.stdout.write(
        final
          ? `${final.operationId}\t${final.type}\tsequence=${final.sequence}\n`
          : `${operationId}\tno-events\n`,
      );
    } else {
      const turnRenderer = new TurnRenderer(theme, makeIO());
      process.stderr.write(`${renderRule(theme, terminalWidth() - 1)}\n`);
      for (const event of events) turnRenderer.render(event);
    }
    return;
  }
  usage();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  process.stderr.write(`educanvas: ${message}\n`);
  process.exitCode = 1;
});
