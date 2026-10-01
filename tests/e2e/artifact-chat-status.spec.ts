import { expect, test } from '@playwright/test';

// 用响应屏障控制任务晚于聊天终态，再验证观察新任务不会回退旧卡片。
test('后台任务失败在聊天完成后收敛且不被下一任务覆盖', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let releaseDetail!: () => void;
  const released = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });
  const firstArtifactId = 'artifact-status-e2e-1';
  await page.route(
    '**/api/v1/chat/artifacts/artifact-status-e2e-*',
    async (route) => {
      const first = route.request().url().endsWith(firstArtifactId);
      if (first) await released;
      await route.fulfill({
        json: {
          artifact: {
            id: first ? firstArtifactId : 'artifact-status-e2e-2',
            kind: 'note',
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
  await page.route('**/api/v1/chat/turn', async (route) => {
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
          kind: 'note',
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
    await expect(page.getByText('AI回答完成', { exact: true })).toBeAttached();
    releaseDetail();
    await expect(card.getByText(/生成失败/)).toBeVisible();
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
    await expect(card.getByText(/生成失败/)).toBeVisible();
    await expect(card.getByText(/正在生成/)).toHaveCount(0);
  } finally {
    releaseDetail();
  }
});
