import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { activeConversationId } from './general-artifact-fixture';

export interface ArtifactConfirmationFixture {
  confirmationId: string;
  conversationId: string;
  notebookId: string;
  otherConversationId: string;
  otherNotebookId: string;
  actorUserId: string;
}

export async function createArtifactConfirmationFixture(
  page: Page,
  title: string,
): Promise<ArtifactConfirmationFixture> {
  const conversationId = await activeConversationId(page);
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) throw new Error('E2E_DATABASE_URL 未设置');
  process.env.DATABASE_URL = databaseUrl;

  const [db, testingDb] = await Promise.all([
    import('@educanvas/db'),
    import('@educanvas/db/testing'),
  ]);
  const { getDb, eq } = testingDb;
  const [conversation] = await getDb()
    .select()
    .from(db.conversations)
    .where(eq(db.conversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new Error('E2E 当前会话行不存在');

  const turns = new db.DrizzlePlatformTurnRepository();
  const proposalTurn = await turns.createOrGetTurn({
    conversationId: conversation.id,
    trustedSubjectId: conversation.ownerSubjectId,
    clientMessageId: randomUUID(),
    text: `建议创建产物：${title}`,
  });
  await turns.settleTurn({
    conversationId: conversation.id,
    trustedSubjectId: conversation.ownerSubjectId,
    turnId: proposalTurn.turnId,
    status: 'completed',
    content: '我可以为你创建一个持久产物。',
  });

  const confirmations = new db.DrizzleArtifactConfirmationRepository();
  const confirmation = await confirmations.createPending({
    actorUserId: conversation.ownerSubjectId,
    notebookId: conversation.spaceId,
    conversationId: conversation.id,
    operationId: proposalTurn.turnId,
    userMessageId: proposalTurn.studentMessage.id,
    artifactKind: 'note',
    title,
  });

  const otherConversation =
    await new db.DrizzlePlatformConversationRepository().create({
      ownerSubjectId: conversation.ownerSubjectId,
      spaceKind: 'notebook',
      spaceTitle: 'E2E confirmation scope check',
    });

  return {
    confirmationId: confirmation.id,
    conversationId: conversation.id,
    notebookId: conversation.spaceId,
    otherConversationId: otherConversation.id,
    otherNotebookId: otherConversation.spaceId,
    actorUserId: conversation.ownerSubjectId,
  };
}

export async function readArtifactConfirmation(confirmationId: string) {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) throw new Error('E2E_DATABASE_URL 未设置');
  process.env.DATABASE_URL = databaseUrl;
  const [db, testingDb] = await Promise.all([
    import('@educanvas/db'),
    import('@educanvas/db/testing'),
  ]);
  const [row] = await testingDb
    .getDb()
    .select()
    .from(testingDb.artifactConfirmationRequests)
    .where(
      testingDb.eq(testingDb.artifactConfirmationRequests.id, confirmationId),
    )
    .limit(1);
  if (!row) throw new Error('E2E confirmation row missing');
  return row;
}
