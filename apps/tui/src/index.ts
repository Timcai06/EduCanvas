#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import {
  GatewayBootstrapClient,
  GatewayClient,
  type GatewayConversationEntry,
} from '@educanvas/gateway-client';
import type { GatewayOperationEvent } from '@educanvas/gateway-core';
import { loadConfig, saveConfig } from './config';

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
  if (!command) usage();
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

  const config = await loadConfig();
  const client = new GatewayClient(config.baseUrl, config.token);
  if (command === 'conversations') {
    for (const conversation of await client.listConversations()) {
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
    const conversation = findConversation(
      await client.listConversations(),
      conversationId,
    );
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
