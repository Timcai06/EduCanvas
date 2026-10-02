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
      const proposalParts = [
        {
          type: 'text' as const,
          text: '请依据上传的 PDF 和所选来源制作课件。',
        },
      ];
      const proposalTurn = await turns.createOrGetTurn({
        conversationId: conversation.id,
        trustedSubjectId: owner,
        clientMessageId: `proposal-${terminalStatus}`,
        parts: proposalParts,
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
      await confirmations.updateKind({
        actorUserId: owner,
        notebookId: conversation.spaceId,
        conversationId: conversation.id,
        confirmationId: confirmation.id,
        artifactKind: 'mind_map',
      });
      const firstKey = artifactConfirmationMessageId(confirmation.id, 1);
      await confirmations.confirm({
        actorUserId: owner,
        notebookId: conversation.spaceId,
        conversationId: conversation.id,
        confirmationId: confirmation.id,
        artifactKind: 'mind_map',
        clientMessageId: firstKey,
      });
      const firstExecution = await confirmations.getForExecution({
        actorUserId: owner,
        notebookId: conversation.spaceId,
        conversationId: conversation.id,
        confirmationId: confirmation.id,
      });
      expect(firstExecution).toMatchObject({
        artifactKind: 'mind_map',
        confirmedKind: 'mind_map',
        proposalParts,
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

      const retriedExecution = await confirmations.getForExecution({
        actorUserId: owner,
        notebookId: conversation.spaceId,
        conversationId: conversation.id,
        confirmationId: confirmation.id,
      });

      expect(retry.attemptNumber).toBe(2);
      expect(retry.confirmationMessageId).toBe(
        artifactConfirmationMessageId(confirmation.id, 2),
      );
      expect(duplicateClick.confirmationMessageId).toBe(
        retry.confirmationMessageId,
      );
      expect(retriedExecution.proposalParts).toEqual(proposalParts);
    },
  );

  it('only exposes proposal parts to the active confirmation under its complete scope', async () => {
    const owner = 'confirmation-source-scope';
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
      spaceTitle: '来源范围测试',
    });
    const proposalParts = [
      { type: 'text' as const, text: '基于已选择的 Notebook 来源创建产物。' },
    ];
    const proposalTurn = await turns.createOrGetTurn({
      conversationId: conversation.id,
      trustedSubjectId: owner,
      clientMessageId: 'proposal-source-scope',
      parts: proposalParts,
    });
    const confirmation = await confirmations.createPending({
      actorUserId: owner,
      notebookId: conversation.spaceId,
      conversationId: conversation.id,
      operationId: proposalTurn.turnId,
      userMessageId: proposalTurn.studentMessage.id,
      artifactKind: 'slides',
      title: 'Notebook 来源产物',
    });
    const scope = {
      actorUserId: owner,
      notebookId: conversation.spaceId,
      conversationId: conversation.id,
      confirmationId: confirmation.id,
    };

    await expect(
      confirmations.getForExecution({ ...scope, actorUserId: 'other-owner' }),
    ).rejects.toMatchObject({ code: 'artifact_confirmation_not_found' });
    await expect(
      confirmations.getForExecution({
        ...scope,
        notebookId: '99999999-9999-4999-8999-999999999999',
      }),
    ).rejects.toMatchObject({ code: 'artifact_confirmation_not_found' });

    await confirmations.cancel(scope);
    await expect(confirmations.getForExecution(scope)).rejects.toMatchObject({
      code: 'artifact_confirmation_not_found',
    });
  });
});
