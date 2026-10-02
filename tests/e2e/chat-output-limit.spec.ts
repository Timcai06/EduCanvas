import { expect, test } from '@playwright/test';

test('输出截断保留部分正文并提示缩小范围，不提供原样重试', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/\/api\/v1\/chat\/turn(?:\?.*)?$/, async (route) => {
    const turnId = 'output-limit-turn';
    const messageId = 'output-limit-assistant';
    const frame = (type: string, data: Record<string, unknown>) =>
      `event: ${type}\ndata: ${JSON.stringify({ type, schemaVersion: '1', turnId, ...data })}\n\n`;
    await route.fulfill({
      contentType: 'text/event-stream; charset=utf-8',
      body: [
        frame('turn.accepted', {
          studentMessageId: 'output-limit-student',
          assistantMessageId: messageId,
          replayed: false,
        }),
        frame('message.delta', {
          messageId,
          delta: '这是已生成并保留的部分正文。',
        }),
        frame('turn.failed', {
          messageId,
          code: 'BUDGET_EXCEEDED',
          retryable: false,
          message:
            '本轮内容超过处理上限，请缩小提问、减少附带来源或分章节生成后再发送。',
        }),
      ].join(''),
    });
  });
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
  await composer.fill('生成一个过长回答');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(
    page.getByText('这是已生成并保留的部分正文。', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      '本轮内容超过处理上限，请缩小提问、减少附带来源或分章节生成后再发送。',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '重新发送' })).toHaveCount(0);
  await expect(composer).toBeEnabled();
  await expect(page.getByText('AI回答失败', { exact: true })).toBeAttached();
});
