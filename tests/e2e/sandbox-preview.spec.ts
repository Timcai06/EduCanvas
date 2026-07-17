import { expect, test } from '@playwright/test';

/**
 * Tier 2 沙箱预览链路(承接 M1 验收债):助手输出 ```html → 预览卡 →
 * 显式点击运行 → 分栏沙箱 iframe 执行。SSE 用与 general-chat-flow 相同的
 * mock 手法,不依赖 Provider;沙箱隔离属性由单测保证,这里验证用户回路。
 */
test('```html 代码块经预览卡在沙箱 iframe 中运行', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/v1/chat/turn', async (route) => {
    const encoder = new TextEncoder();
    const turnId = 'sandbox-turn-e2e';
    const messageId = 'sandbox-assistant-e2e';
    const frame = (type: string, data: Record<string, unknown>) =>
      encoder.encode(
        `event: ${type}\ndata: ${JSON.stringify({ type, schemaVersion: '1', ...data })}\n\n`,
      );
    const markdown =
      '试试这个互动演示:\n\n```html\n<h1>沙箱内容OK</h1>\n<button onclick="this.textContent=\'点过了\'">点我</button>\n```\n';
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: Buffer.concat([
        frame('turn.accepted', {
          turnId,
          studentMessageId: 'sandbox-student-e2e',
          assistantMessageId: messageId,
          replayed: false,
        }),
        frame('message.delta', { turnId, messageId, delta: markdown }),
        frame('turn.completed', { turnId, messageId }),
      ]).toString(),
    });
  });

  await page.goto('/');
  const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
  await composer.fill('给我一个可以点的演示');
  await composer.press('Enter');

  /* 预览卡出现,代码不直接执行 */
  const previewCard = page.getByRole('button', { name: /互动内容/ });
  await expect(previewCard).toBeVisible();
  await expect(page.locator('iframe[title="互动内容沙箱预览"]')).toHaveCount(0);

  /* 显式运行后,分栏沙箱 iframe 渲染模型 HTML */
  await previewCard.click();
  const sandboxFrame = page.frameLocator('iframe[title="互动内容沙箱预览"]');
  await expect(sandboxFrame.getByText('沙箱内容OK')).toBeVisible();

  /* 沙箱内脚本可交互(allow-scripts),但仍与宿主隔离 */
  await sandboxFrame.getByRole('button', { name: '点我' }).click();
  await expect(sandboxFrame.getByRole('button', { name: '点过了' })).toBeVisible();

  await page.getByRole('button', { name: '关闭预览' }).click();
  await expect(page.locator('iframe[title="互动内容沙箱预览"]')).toHaveCount(0);
});
