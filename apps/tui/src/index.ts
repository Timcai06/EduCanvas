#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import {
  GatewayBootstrapClient,
  type GatewayConversationEntry,
} from '@educanvas/gateway-client';
import type { GatewayOperationEvent } from '@educanvas/gateway-core';
import { saveConfig } from './config';
import { establishGatewaySession } from './session';

function usage(): never {
  process.stderr.write(`EduCanvas TUI\n\n`);
  process.stderr.write(`  educanvas login <gateway-url> <user-id>\n`);
  process.stderr.write(`  educanvas conversations\n`);
  process.stderr.write(`  educanvas chat <conversation-id> <message...>\n`);
  process.stderr.write(`  educanvas resume <operation-id> [after-sequence]\n`);
  process.stderr.write(`  educanvas status <operation-id>\n`);
  process.stderr.write(`  educanvas approvals\n`);
  process.stderr.write(`  educanvas approve <approval-id> [reason]\n`);
  process.stderr.write(`  educanvas deny <approval-id> [reason]\n`);
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

function renderEvent(event: GatewayOperationEvent): void {
  if (event.type === 'message.delta') process.stdout.write(event.delta);
  else if (event.type === 'tool.started') {
    process.stderr.write(`\n[tool] ${event.tool}\n`);
  } else if (event.type === 'approval.required') {
    process.stderr.write(
      `\n[approval required] ${event.approval.approvalId}: ${event.approval.summary}\n`,
    );
  } else if (event.type === 'operation.completed') {
    process.stdout.write('\n');
    process.stderr.write(`[completed] ${event.operationId}\n`);
  } else if (event.type === 'operation.failed') {
    process.stderr.write(`\n[failed] ${event.code}\n`);
  } else if (event.type === 'operation.cancelled') {
    process.stderr.write(`\n[cancelled] ${event.operationId}\n`);
  }
}

function findConversation(
  conversations: readonly GatewayConversationEntry[],
  id: string,
): GatewayConversationEntry {
  const conversation = conversations.find((item) => item.conversationId === id);
  if (!conversation) throw new Error('Conversation is not accessible');
  return conversation;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
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
      `Logged in as ${session.userId}; expires ${session.expiresAt}\n`,
    );
    return;
  }

  const baseUrl =
    process.env.EDUCANVAS_GATEWAY_URL?.trim() || 'http://127.0.0.1:3200';
  const { client, conversations: initialConversations } =
    await establishGatewaySession(baseUrl);
  if (!command) {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const conversations = [...initialConversations];
    let current = conversations[0];
    if (!current) throw new Error('当前账户没有可访问的 Notebook');
    process.stdout.write(
      `EduCanvas TUI · ${current.title ?? '未命名笔记本'}\n` +
        '输入消息开始对话；/notebooks 查看笔记本，/use <id> 切换，/web 打开 Web，/help 查看命令。\n\n',
    );
    try {
      while (true) {
        const line = (await readline.question('educanvas> ')).trim();
        if (!line) continue;
        if (line === '/quit' || line === '/exit') break;
        if (line === '/help') {
          process.stdout.write(
            '/notebooks · /use <id> · /approvals · /web · /quit\n',
          );
          continue;
        }
        if (line === '/notebooks') {
          for (const conversation of conversations) {
            const active =
              conversation.conversationId === current.conversationId
                ? '*'
                : ' ';
            process.stdout.write(
              `${active} ${conversation.conversationId}\t${conversation.title ?? '未命名笔记本'}\n`,
            );
          }
          continue;
        }
        if (line.startsWith('/use ')) {
          current = findConversation(conversations, line.slice(5).trim());
          process.stdout.write(
            `已切换到 ${current.title ?? current.conversationId}\n`,
          );
          continue;
        }
        if (line === '/approvals') {
          const approvals = await client.listApprovals();
          if (approvals.length === 0)
            process.stdout.write('没有待处理审批。\n');
          for (const approval of approvals) {
            process.stdout.write(
              `${approval.approvalId}\t${approval.risk}\t${approval.summary}\n`,
            );
          }
          continue;
        }
        if (line === '/web') {
          const webUrl =
            process.env.EDUCANVAS_WEB_URL?.trim() || 'http://127.0.0.1:3101';
          openWeb(webUrl);
          process.stdout.write(`已打开 ${webUrl}\n`);
          continue;
        }
        for await (const event of client.streamTurn({
          clientMessageId: `tui:${randomUUID()}`,
          notebookId: current.notebookId,
          conversationId: current.conversationId,
          parts: [{ type: 'text', text: line }],
        }))
          renderEvent(event);
      }
    } finally {
      readline.close();
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
    for await (const event of client.streamTurn({
      clientMessageId: `tui:${randomUUID()}`,
      notebookId: conversation.notebookId,
      conversationId: conversation.conversationId,
      parts: [{ type: 'text', text: message }],
    }))
      renderEvent(event);
    return;
  }
  if (command === 'approvals') {
    for (const approval of await client.listApprovals()) {
      process.stdout.write(
        `${approval.approvalId}\t${approval.risk}\t${approval.capability}\t${approval.summary}\n`,
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
      `${approvalId}\t${command === 'approve' ? 'approved' : 'denied'}\n`,
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
      for (const event of events) renderEvent(event);
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
