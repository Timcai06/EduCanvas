import { expect, test } from '@playwright/test';

test('根入口默认创建通用Chat，界面上不存在K12模式入口', async ({
  context,
  page,
}) => {
  await page.route('**/api/v1/chat/turn', async (route) => {
    const encoder = new TextEncoder();
    const turnId = 'general-turn-e2e';
    const messageId = 'general-assistant-e2e';
    const frame = (type: string, data: Record<string, unknown>) =>
      encoder.encode(
        `event: ${type}\ndata: ${JSON.stringify({ type, schemaVersion: '1', ...data })}\n\n`,
      );
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: Buffer.concat([
        frame('turn.accepted', {
          turnId,
          studentMessageId: 'general-student-e2e',
          assistantMessageId: messageId,
          replayed: false,
        }),
        frame('message.delta', {
          turnId,
          messageId,
          delta: '我们先明确目标，再选择最合适的实现路径。',
        }),
        frame('turn.completed', { turnId, messageId }),
      ]).toString(),
    });
  });

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '你好，今天想探索什么？' }),
  ).toBeVisible();
  /* 产品决策:多模态 Agent 是第一身份,不存在"K12 模式"入口(student-ui-spec) */
  await expect(page.getByRole('link', { name: 'K12 学习模式' })).toHaveCount(0);
  await expect(page.getByText(/猫狗|学习进度|开始学习/)).toHaveCount(0);

  const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
  await composer.fill('帮我分析一个产品想法');
  await composer.press('Enter');

  await expect(page.getByText('帮我分析一个产品想法')).toBeVisible();
  await expect(
    page.getByText('我们先明确目标，再选择最合适的实现路径。'),
  ).toBeVisible();
  /* U1 侧栏:当前会话出现在历史列表(本 spec 的 turn 被 mock,服务端不落
     消息,标题保持空;真实标题=首条消息的行为由仓储层保证) */
  await expect(
    page
      .getByRole('navigation', { name: '历史对话' })
      .getByText('未命名对话'),
  ).toBeVisible();

  /* U2 v1:来源常驻区在侧栏可见 */
  await expect(
    page
      .getByRole('navigation', { name: '历史对话' })
      .getByText('来源', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '上传 PDF 来源' }),
  ).toBeVisible();

  const cookieNames = (await context.cookies())
    .filter((cookie) => cookie.httpOnly && cookie.path === '/')
    .map((cookie) => cookie.name);
  expect(cookieNames).toContain('__Host-educanvas_anonymous_identity');
  expect(cookieNames).toContain('__Host-educanvas_active_conversation');
});
