import { expect, test, type Page } from '@playwright/test';
import {
  activeConversationId,
  closeNotebookSidebar,
  createNotebook,
  openNotebookSidebar,
  openStudioInput,
  closeStudio,
  waitForUnavailableTurn,
} from './helpers/journey-helpers';

test('@smoke General 黄金旅程：Turn 生命周期', async ({ context, page }) => {
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
    page.getByRole('heading', { name: '今天想学什么？' }),
  ).toBeVisible();
  /* 产品决策:多模态 Agent 是第一身份,不存在"K12 模式"入口(student-ui-spec) */
  await expect(page.getByRole('link', { name: 'K12 学习模式' })).toHaveCount(0);
  await expect(page.getByText(/猫狗|学习进度|开始学习/)).toHaveCount(0);

  const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
  await composer.fill('帮我分析一个产品想法');
  /* 等 React 状态落定（发送按钮仅在 hasPayload 时渲染），避免 Enter 被旧闭包吞掉 */
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled();
  await composer.press('Enter');

  await expect(page.getByText('帮我分析一个产品想法')).toBeVisible();
  await expect(
    page.getByText('我们先明确目标，再选择最合适的实现路径。'),
  ).toBeVisible();
  /* 当前Notebook出现在列表(本 spec 的 turn 被 mock,服务端不落
     消息,标题保持空;真实标题=首条消息的行为由仓储层保证)。
     窄屏下笔记本列表是覆盖抽屉：先展开断言，再收起，否则遮罩挡住主区。 */
  const sidebar = await openNotebookSidebar(page);
  await expect(sidebar.getByText('未命名笔记本')).toBeVisible();

  /* 当前 Notebook 的来源与输出属于 Studio，不再混入历史列表。 */
  await expect(sidebar.getByText('来源', { exact: true })).toHaveCount(0);
  await closeNotebookSidebar(page);
  const studio = await openStudioInput(page);
  await expect(studio.getByRole('list', { name: '来源列表' })).toBeVisible();

  const cookieNames = (await context.cookies())
    .filter((cookie) => cookie.httpOnly && cookie.path === '/')
    .map((cookie) => cookie.name);
  expect(cookieNames).toContain('__Host-educanvas_anonymous_identity');
  expect(cookieNames).toContain('__Host-educanvas_active_conversation');
});

test('@smoke General 黄金旅程：历史恢复', async ({ page }) => {
  // 该旅程包含两次真实不可用模型收敛和两次服务端会话切换；慢 CI runner
  // 已稳定完成全部断言但耗时约 96s，显式预算避免 90s 通用 slow 上限误杀。
  test.setTimeout(120_000);
  const firstPrompt = '太阳能小车研究笔记本';
  const secondPrompt = '校园雨水花园笔记本';

  await page.goto('/');
  const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
  await composer.fill(firstPrompt);
  /* 等 React 状态落定（发送按钮仅在 hasPayload 时渲染），避免 Enter 被旧闭包吞掉 */
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled();
  await composer.press('Enter');
  await expect(
    page
      .getByRole('region', { name: 'AI 对话' })
      .getByText(firstPrompt, { exact: true }),
  ).toBeVisible();
  await waitForUnavailableTurn(page);

  const notebooks = await openNotebookSidebar(page);
  const firstConversationContent = page
    .getByRole('region', { name: 'AI 对话' })
    .getByText(firstPrompt, { exact: true });
  await createNotebook(
    page,
    notebooks.getByRole('button', { name: '新建笔记本' }),
    firstConversationContent,
  );

  await page
    .getByRole('textbox', { name: '向 EduCanvas 提问' })
    .fill(secondPrompt);
  await page.getByRole('textbox', { name: '向 EduCanvas 提问' }).press('Enter');
  /* 乐观消息先进入对话；此刻 GSAP 入场可能仍在过渡。切换后的可见性在下方验证。 */
  await expect(page.getByRole('region', { name: 'AI 对话' })).toContainText(
    secondPrompt,
  );
  await waitForUnavailableTurn(page);

  await (
    await openNotebookSidebar(page)
  )
    .getByRole('button', { name: new RegExp(firstPrompt) })
    .click();
  let chat = page.getByRole('region', { name: 'AI 对话' });
  await expect(chat.getByText(firstPrompt, { exact: true })).toBeVisible();
  await expect(chat.getByText(secondPrompt, { exact: true })).toHaveCount(0);

  await (
    await openNotebookSidebar(page)
  )
    .getByRole('button', { name: new RegExp(secondPrompt) })
    .click();
  chat = page.getByRole('region', { name: 'AI 对话' });
  await expect(chat.getByText(secondPrompt, { exact: true })).toBeVisible();
  await expect(chat.getByText(firstPrompt, { exact: true })).toHaveCount(0);
});

test('@smoke General 黄金旅程：工具与引用结果', async ({ page }) => {
  await page.route('**/api/v1/chat/turn', async (route) => {
    const encoder = new TextEncoder();
    const turnId = 'web-research-turn-e2e';
    const messageId = 'web-research-assistant-e2e';
    const frame = (type: string, data: Record<string, unknown>) =>
      encoder.encode(
        `event: ${type}\ndata: ${JSON.stringify({ type, schemaVersion: '1', turnId, ...data })}\n\n`,
      );
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: Buffer.concat([
        frame('turn.accepted', {
          studentMessageId: 'web-research-student-e2e',
          assistantMessageId: messageId,
          replayed: false,
        }),
        frame('tool.started', {
          toolCallId: 'search-1',
          label: '正在搜索网页',
        }),
        frame('tool.completed', { toolCallId: 'search-1' }),
        frame('tool.started', {
          toolCallId: 'page-1',
          label: '正在读取网页',
        }),
        frame('tool.completed', { toolCallId: 'page-1' }),
        frame('tool.started', {
          toolCallId: 'page-2',
          label: '正在读取网页',
        }),
        frame('tool.completed', { toolCallId: 'page-2' }),
        frame('message.delta', {
          messageId,
          delta:
            '第一份资料说明方案重视可达性 [1]；第二份资料给出了学习收益证据 [2]。',
        }),
        frame('message.citation', {
          messageId,
          citationId: 'web-citation-1',
          marker: 1,
          kind: 'web',
          assetId: 'asset-web-1',
          assetVersionId: 'asset-version-web-1',
          label: '可达性设计指南',
          url: 'https://example.com/accessibility',
          pageStart: null,
          pageEnd: null,
        }),
        frame('message.citation', {
          messageId,
          citationId: 'web-citation-2',
          marker: 2,
          kind: 'web',
          assetId: 'asset-web-2',
          assetVersionId: 'asset-version-web-2',
          label: '学习收益研究',
          url: 'https://example.org/learning-study',
          pageStart: null,
          pageEnd: null,
        }),
        frame('turn.completed', { messageId }),
      ]).toString(),
    });
  });

  await page.goto('/');
  const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
  await composer.fill('搜索网页并比较两份资料');
  /* 触屏窄屏由发送按钮承担发送（composer 设计：Enter 发送仅适用于桌面/物理键盘），
     发送按钮仅在 hasPayload 时渲染，其 enabled 同时充当 React 状态落定同步点 */
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled();
  await page.getByRole('button', { name: '发送' }).click();

  await expect(page.getByText(/第一份资料说明方案重视可达性/)).toBeVisible();
  const firstSource = page.getByRole('link', { name: /1 可达性设计指南/ });
  const secondSource = page.getByRole('link', { name: /2 学习收益研究/ });
  await expect(firstSource).toHaveAttribute(
    'href',
    'https://example.com/accessibility',
  );
  await expect(secondSource).toHaveAttribute(
    'href',
    'https://example.org/learning-study',
  );
  await expect(firstSource).toHaveAttribute('target', '_blank');
});
