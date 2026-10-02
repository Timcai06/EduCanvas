import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  createArtifactFixture,
  ensureGeneralNotebook,
} from './fixtures/general-artifact-fixture';

// 用响应屏障控制任务晚于聊天终态，再验证观察新任务不会回退旧卡片。
for (const kind of ['note', 'picturebook']) {
  test(`重叠 ${kind} 任务在下一任务开始后仍收敛聊天失败卡片`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let releaseDetail!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseDetail = resolve;
    });
    const firstArtifactId = 'artifact-status-e2e-1';
    await page.route(
      '**/api/v1/chat/artifacts/artifact-status-e2e-*',
      async (route) => {
        const first = new URL(route.request().url()).pathname.endsWith(
          firstArtifactId,
        );
        if (first) await released;
        await route.fulfill({
          json: {
            artifact: {
              id: first ? firstArtifactId : 'artifact-status-e2e-2',
              kind: first ? kind : 'note',
              trustTier: 'tier1',
              title: first ? '任务状态笔记' : '下一任务笔记',
              status: 'proposed',
              latestVersion: 0,
              fromConversation: true,
              createdAt: '2026-10-01T00:00:00Z',
              updatedAt: '2026-10-01T00:00:01Z',
            },
            version: null,
            versions: [],
            latestJob: {
              id: 'job-e2e',
              status: first ? 'failed' : 'running',
              progress: null,
              failureCode: first ? 'model_output_limit' : null,
            },
          },
        });
      },
    );
    let turnSequence = 0;
    await page.route(/\/api\/v1\/chat\/turn(?:\?.*)?$/, async (route) => {
      const first = ++turnSequence === 1;
      const turnId = `artifact-status-turn-${turnSequence}`;
      const messageId = `artifact-status-assistant-${turnSequence}`;
      const frame = (type: string, data: Record<string, unknown>) =>
        `event: ${type}\ndata: ${JSON.stringify({ type, schemaVersion: '1', turnId, ...data })}\n\n`;
      await route.fulfill({
        contentType: 'text/event-stream; charset=utf-8',
        body: [
          frame('turn.accepted', {
            studentMessageId: `artifact-status-student-${turnSequence}`,
            assistantMessageId: messageId,
            replayed: false,
          }),
          frame('artifact.proposed', {
            artifactId: first ? firstArtifactId : 'artifact-status-e2e-2',
            kind: first ? kind : 'note',
            trustTier: 'tier1',
            title: first ? '任务状态笔记' : '下一任务笔记',
          }),
          frame('message.delta', {
            messageId,
            delta: first ? '后台任务已创建。' : '下一任务已创建。',
          }),
          frame('turn.completed', { messageId }),
        ].join(''),
      });
    });
    try {
      await page.goto('/');
      const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
      await composer.fill('生成任务状态笔记');
      await page.getByRole('button', { name: '发送' }).click();
      await expect(
        page.getByText('后台任务已创建。', { exact: true }),
      ).toBeVisible();
      const card = page.getByRole('button', { name: '打开产物：任务状态笔记' });
      await expect(card.getByText(/正在生成/)).toBeVisible();
      await expect(
        page.getByText('AI回答完成', { exact: true }),
      ).toBeAttached();
      await composer.fill('生成下一任务笔记');
      await page.getByRole('button', { name: '发送' }).click();
      await expect(
        page.getByText('下一任务已创建。', { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole('button', { name: '打开产物：下一任务笔记' })
          .getByText(/正在生成/),
      ).toBeVisible();
      await expect(card.getByText(/正在生成/)).toBeVisible();
      releaseDetail();
      await expect(card.getByText(/生成失败/)).toBeVisible();
      await expect(card.getByText(/正在生成/)).toHaveCount(0);
    } finally {
      releaseDetail();
    }
  });

  test(`重新打开历史 ${kind} 任务后从真实 running job 收敛为失败`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await ensureGeneralNotebook(page);
    const fixture = await createArtifactFixture(
      page,
      kind as 'note' | 'picturebook',
      `历史状态${kind}`,
    );
    process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    const {
      DrizzlePlatformArtifactRepository,
      DrizzlePlatformTurnRepository,
      conversations,
    } = await import('@educanvas/db');
    const { getDb, eq } = await import('@educanvas/db/testing');
    const [conversation] = await getDb()
      .select()
      .from(conversations)
      .where(eq(conversations.id, fixture.conversationId))
      .limit(1);
    if (!conversation) throw new Error('历史产物测试会话不存在');
    const turns = new DrizzlePlatformTurnRepository();
    const turn = await turns.createOrGetTurn({
      conversationId: conversation.id,
      trustedSubjectId: conversation.ownerSubjectId,
      clientMessageId: randomUUID(),
      text: `生成${fixture.title}`,
    });
    await turns.settleTurn({
      conversationId: conversation.id,
      trustedSubjectId: conversation.ownerSubjectId,
      turnId: turn.turnId,
      status: 'completed',
      content: '历史任务已提交。',
    });
    const artifacts = new DrizzlePlatformArtifactRepository();
    const job = await artifacts.createGenerationJob({
      artifactId: fixture.artifactId,
      trustedSubjectId: conversation.ownerSubjectId,
      operationId: turn.turnId,
    });
    await artifacts.transitionGenerationJob({
      jobId: job.id,
      trustedSubjectId: conversation.ownerSubjectId,
      to: 'running',
    });
    await page.goto(
      `/notebook/${conversation.spaceId}/conversation/${conversation.id}`,
    );
    const card = page.getByRole('button', {
      name: `打开产物：${fixture.title}`,
    });
    await expect(card.getByText(/正在生成/)).toBeVisible();
    await artifacts.transitionGenerationJob({
      jobId: job.id,
      trustedSubjectId: conversation.ownerSubjectId,
      to: 'failed',
      failureCode: 'model_output_limit',
    });
    await expect(card.getByText(/生成失败/)).toBeVisible();
    await expect(card.getByText(/正在生成/)).toHaveCount(0);
  });
}
