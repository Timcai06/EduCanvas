process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import {
  DrizzleAgentModelRunRepository,
  DrizzleAgentToolCallRepository,
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayOperationStore,
  DrizzleMcpIntentRepository,
  DrizzleOperationContinuationRepository,
  DrizzlePlatformConversationRepository,
  DrizzlePlatformTurnRepository,
  DrizzleToolApprovalIntentRepository,
  getDb,
} from '@educanvas/db';
import {
  AesGcmMcpIntentCipher,
  type McpToolRegistration,
} from '@educanvas/mcp-runtime';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { runOnce } from 'graphile-worker';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach } from 'vitest';

export const connectionString = process.env.TEST_DATABASE_URL!;
export const now = new Date('2026-07-21T15:00:00.000Z');
export const mcpKey = Buffer.alloc(32, 6).toString('base64');
export const mcpRegistration: McpToolRegistration & {
  risk: 'l2';
  effect: 'write';
  capability: 'external.mcp.invoke';
} = {
  serverId: 'study-tools',
  endpoint: 'http://127.0.0.1:4321/mcp',
  remoteToolName: 'publish',
  modelToolName: 'publishNotes',
  description: '发布学习笔记',
  capability: 'external.mcp.invoke',
  risk: 'l2',
  effect: 'write',
  authentication: 'none',
  inputSchema: {
    type: 'object',
    properties: { title: { type: 'string', maxLength: 100 } },
    required: ['title'],
    additionalProperties: false,
  },
  timeoutMs: 2_000,
};

export const database = getDb();

export async function createWaitingApproval(kind: 'node' | 'mcp' = 'node') {
  const actorId = 'user:approval-continuation';
  const conversations = new DrizzlePlatformConversationRepository(database);
  const identities = new DrizzleGatewayIdentityRepository(database);
  const operations = new DrizzleGatewayOperationStore(database);
  const turns = new DrizzlePlatformTurnRepository(database);
  const conversation = await conversations.create({
    ownerSubjectId: actorId,
    spaceKind: 'notebook',
    spaceTitle: '审批续跑测试',
    now,
  });
  const identity = await identities.getActive(actorId);
  if (!identity) throw new Error('测试身份创建失败');
  const operation = await operations.begin({
    envelopeId: `envelope:${actorId}`,
    idempotencyKey: 'approval-continuation-message',
    requestFingerprint: 'a'.repeat(64),
    route: {
      actorUserId: actorId,
      agentId: identity.agentId,
      notebookId: conversation.spaceId,
      conversationId: conversation.id,
      membershipRole: 'owner',
    },
    now,
  });
  await operations.append(
    operation.operationId,
    { type: 'operation.accepted' },
    now,
  );
  const turn = await turns.attachGatewayTurn({
    operationId: operation.operationId,
    conversationId: conversation.id,
    trustedSubjectId: actorId,
    clientMessageId: 'approval-continuation-message',
    parts: [{ type: 'text', text: '读取受控设备资料' }],
    now,
  });
  const modelRun = await new DrizzleAgentModelRunRepository(
    database,
  ).createOrGet({
    operationId: operation.operationId,
    actorId,
    assistantMessageId: turn.assistantMessage.id,
    phase: 'answer',
    taskAlias: 'agent.turn',
    modelAlias: 'primary',
    promptVersion: 'approval-continuation-v1',
    promptHash: 'b'.repeat(64),
    now,
  });
  const toolCall = await new DrizzleAgentToolCallRepository(
    database,
  ).createOrGet({
    operationId: operation.operationId,
    actorId,
    answerModelRunId: modelRun.run.id,
    providerToolCallId: 'provider-call:approval-continuation',
    executionId: `execution:${operation.operationId}`,
    toolName: kind === 'mcp' ? 'publishNotes' : 'readAllowlistedFile',
    exposure: 'model',
    effect: kind === 'mcp' ? 'write' : 'read',
    arguments:
      kind === 'mcp' ? { title: '分数错题本' } : { path: 'notes/algebra.md' },
    now,
  });
  const approvalId = `approval:${operation.operationId}`;
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  const continuations = new DrizzleOperationContinuationRepository(database);
  const resumeRef =
    kind === 'mcp'
      ? `mcp.intent:${'c'.repeat(64)}`
      : `node-invocation:${operation.operationId}`;
  if (kind === 'mcp') {
    const metadata = {
      resumeRef,
      operationId: operation.operationId,
      toolCallId: toolCall.call.id,
      actorId,
      agentId: identity.agentId,
      serverId: mcpRegistration.serverId,
      remoteToolName: mcpRegistration.remoteToolName,
      modelToolName: mcpRegistration.modelToolName,
      capability: mcpRegistration.capability,
      risk: mcpRegistration.risk,
      effect: mcpRegistration.effect,
      semanticsHash: AesGcmMcpIntentCipher.fromBase64(mcpKey).semanticsHash({
        registration: mcpRegistration,
        arguments: { title: '分数错题本' },
      }),
      expiresAt,
    };
    await new DrizzleMcpIntentRepository(database).prepare({
      metadata,
      sealedPayload: AesGcmMcpIntentCipher.fromBase64(mcpKey).seal({
        metadata,
        payload: {
          arguments: { title: '分数错题本' },
          credentialHandle: null,
        },
      }),
      now,
    });
  }
  await new DrizzleToolApprovalIntentRepository(database).prepare({
    operationId: operation.operationId,
    actorId,
    approvalId,
    expiresAt,
    work: {
      kind: 'tool_invocation',
      step: 'tool.invoke',
      toolCallId: toolCall.call.id,
      adapterSource: kind,
      resumeRef,
    },
    now,
  });
  await operations.append(
    operation.operationId,
    {
      type: 'approval.required',
      approval: {
        approvalId,
        operationId: operation.operationId,
        actorUserId: actorId,
        capability:
          kind === 'mcp'
            ? mcpRegistration.capability
            : 'filesystem.read_allowlisted',
        risk: 'l2',
        summary: kind === 'mcp' ? '发布学习笔记' : '读取白名单内的学习资料',
        requestedAt: now.toISOString(),
        expiresAt,
      },
    },
    now,
  );
  const waiting = await continuations.getActive({
    operationId: operation.operationId,
    actorId,
  });
  if (!waiting) throw new Error('Gateway未原子创建continuation');
  return {
    actorId,
    approvalId,
    assistantMessageId: turn.assistantMessage.id,
    conversationId: conversation.id,
    operationId: operation.operationId,
    continuationId: waiting.continuationId,
    notebookId: conversation.spaceId,
    toolCallId: toolCall.call.id,
    operations,
  };
}

export function installApprovalContinuationIntegrationHooks() {
  beforeAll(async () => {
    await migrate(database, {
      migrationsFolder: fileURLToPath(
        new URL('../../../packages/db/drizzle', import.meta.url),
      ),
    });
    await runOnce({ connectionString, taskList: { noop: async () => {} } });
  });

  beforeEach(async () => {
    await database.execute(sql`
      truncate table mcp_tool_intents, operation_continuations, tool_approval_intents, gateway_approvals,
        gateway_operation_events, tool_effects, tool_calls, model_runs,
        conversation_messages, agent_operations, conversations, spaces,
        personal_agents, platform_users
      restart identity cascade
    `);
    await database.execute(sql`delete from graphile_worker._private_jobs`);
  });
}
