import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DrizzleArtifactConfirmationRepository,
  artifactConfirmationMessageId,
} from './artifact-confirmation-repository';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import { DrizzlePlatformTurnRepository } from './platform-turn-repository';
import { agentOperations } from './schema';
import * as schema from './schema';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (!databaseName.endsWith('_integration') && !databaseName.endsWith('_test'))
    throw new Error('集成测试拒绝使用非隔离数据库');
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 4 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;
function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

describeWithDatabase('artifact confirmation retry attempts', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table artifact_confirmation_requests, artifact_generation_jobs,
        artifacts, conversation_messages, agent_operations, conversations, spaces
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it.each(['failed', 'cancelled'] as const)(
    'allocates exactly one fresh idempotency key after a post-start %s with no artifact',
    async (terminalStatus) => {
      const owner = `confirmation-retry-${terminalStatus}`;
      const conversations = new DrizzlePlatformConversationRepository(
        getDatabase(),
      );
      const turns = new DrizzlePlatformTurnRepository(getDatabase());
      const confirmations = new DrizzleArtifactConfirmationRepository(
        getDatabase(),
      );
      const conversation = await conversations.create({
        ownerSubjectId: owner,
        spaceKind: 'notebook',
        spaceTitle: '确认重试测试',
      });
      const proposalTurn = await turns.createOrGetTurn({
        conversationId: conversation.id,
        trustedSubjectId: owner,
        clientMessageId: `proposal-${terminalStatus}`,
        text: '提议创建Slides',
      });
      await getDatabase()
        .update(agentOperations)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(agentOperations.id, proposalTurn.turnId));
      const confirmation = await confirmations.createPending({
        actorUserId: owner,
        notebookId: conversation.spaceId,
        conversationId: conversation.id,
        operationId: proposalTurn.turnId,
        userMessageId: proposalTurn.studentMessage.id,
        artifactKind: 'slides',
        title: '课程Slides',
      });
      const firstKey = artifactConfirmationMessageId(confirmation.id, 1);
      await confirmations.confirm({
        actorUserId: owner,
        notebookId: conversation.spaceId,
        conversationId: conversation.id,
        confirmationId: confirmation.id,
        artifactKind: 'slides',
        clientMessageId: firstKey,
      });
      const failedAttempt = await turns.createOrGetTurn({
        conversationId: conversation.id,
        trustedSubjectId: owner,
        clientMessageId: firstKey,
        text: '执行已启动的确认尝试',
      });
      await getDatabase()
        .update(agentOperations)
        .set({ status: terminalStatus, completedAt: new Date() })
        .where(eq(agentOperations.id, failedAttempt.turnId));

      const [retry, duplicateClick] = await Promise.all(
        Array.from({ length: 2 }, () =>
          confirmations.updateKind({
            actorUserId: owner,
            notebookId: conversation.spaceId,
            conversationId: conversation.id,
            confirmationId: confirmation.id,
            artifactKind: 'slides',
          }),
        ),
      );
      if (!retry || !duplicateClick)
        throw new Error('confirmation_retry_result_missing');

      expect(retry.attemptNumber).toBe(2);
      expect(retry.confirmationMessageId).toBe(
        artifactConfirmationMessageId(confirmation.id, 2),
      );
      expect(duplicateClick.confirmationMessageId).toBe(
        retry.confirmationMessageId,
      );
    },
  );
});
