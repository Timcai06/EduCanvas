import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ACTIVE_CONVERSATION_COOKIE = '__Host-educanvas_active_conversation';
const STUDIO_TRIGGER_NAME = '展开当前笔记本的输入与输出';

/* 用 DOM 属性定位而非 getByRole：抽屉收起时 aria-hidden+inert 会把 aside
   移出可访问性树，role 定位器计数为 0（实验已验证），状态探测全部落空。 */
function notebookSidebar(page: Page) {
  return page.locator('aside[aria-label="笔记本侧栏"]');
}

/*
 * 窄屏（<lg）笔记本列表是覆盖抽屉：初始收起并带 inert/aria-hidden，
 * 桌面端挂载后自动展开。交互前必须展开（幂等），否则定位与点击全部落空。
 */
async function openNotebookSidebar(page: Page) {
  const sidebar = notebookSidebar(page);
  if ((await sidebar.getAttribute('aria-hidden')) === 'true') {
    await page.getByRole('button', { name: '打开笔记本列表' }).click();
  }
  await expect(sidebar).toHaveAttribute('aria-hidden', 'false');
  return sidebar;
}

/* 收起抽屉：展开状态下遮罩会拦截主区指针事件（桌面端抽屉在流内无遮罩）。 */
async function closeNotebookSidebar(page: Page) {
  const sidebar = notebookSidebar(page);
  if ((await sidebar.getAttribute('aria-hidden')) === 'false') {
    await page.getByRole('button', { name: '收起笔记本侧栏' }).click();
  }
  await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
}

async function openStudioInput(page: Page) {
  await page.getByRole('button', { name: STUDIO_TRIGGER_NAME }).click();
  const studio = page.getByRole('complementary', {
    name: '当前笔记本的 Studio',
  });
  const wheel = studio.getByRole('listbox', { name: '选择 Studio 能力' });
  await wheel.press('Enter');
  await expect(
    studio.getByRole('listbox', { name: '浏览当前Notebook来源' }),
  ).toBeVisible();
  return studio;
}

async function openStudioOutput(page: Page) {
  await page.getByRole('button', { name: STUDIO_TRIGGER_NAME }).click();
  const studio = page.getByRole('complementary', {
    name: '当前笔记本的 Studio',
  });
  const wheel = studio.getByRole('listbox', { name: '选择 Studio 能力' });
  await wheel.press('ArrowDown');
  await wheel.press('Enter');
  await expect(
    studio.getByRole('listbox', { name: '浏览当前Notebook的AI产物' }),
  ).toBeVisible();
  return studio;
}

async function closeStudio(page: Page) {
  await page.getByRole('button', { name: STUDIO_TRIGGER_NAME }).click();
  await expect(
    page.getByRole('complementary', { name: '当前笔记本的 Studio' }),
  ).toHaveCount(0);
}

async function activeConversationId(page: Page) {
  return (await page.context().cookies()).find(
    (cookie) => cookie.name === ACTIVE_CONVERSATION_COOKIE,
  )?.value;
}

async function createNotebook(
  page: Page,
  trigger: Locator,
  previousConversationContent: Locator,
) {
  const previousConversationId = await activeConversationId(page);
  expect(previousConversationId).toBeDefined();

  await trigger.click();
  await expect
    .poll(() => activeConversationId(page), {
      message: '新建笔记本后应切换服务端权威的活动会话',
      timeout: 15_000,
    })
    .not.toBe(previousConversationId);

  await expect(previousConversationContent).toHaveCount(0, {
    timeout: 15_000,
  });

  const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue('');
  await expect(
    page.getByRole('region', { name: 'EduCanvas 技术栈' }),
  ).toBeVisible();
  /* 切换会话若未触发整页重载，窄屏抽屉仍会展开：幂等收起，
     避免遮罩拦截后续主区交互。 */
  await closeNotebookSidebar(page);
}

async function waitForUnavailableTurn(page: Page) {
  await expect(page.getByText('AI 暂时无法回答，请稍后重试。')).toBeVisible({
    timeout: 30_000,
  });
}

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
  await expect(
    studio.getByRole('listbox', { name: '浏览当前Notebook来源' }),
  ).toBeVisible();

  const cookieNames = (await context.cookies())
    .filter((cookie) => cookie.httpOnly && cookie.path === '/')
    .map((cookie) => cookie.name);
  expect(cookieNames).toContain('__Host-educanvas_anonymous_identity');
  expect(cookieNames).toContain('__Host-educanvas_active_conversation');
});

test('笔记本可反复切换，并整体恢复各自的消息', async ({ page }) => {
  test.slow();
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

test('切换笔记本时 Sources 与 Studio 作为整体隔离', async ({ page }) => {
  test.slow();
  const firstPrompt = '第一本：机器视觉资料';
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
  /* 学生消息先乐观渲染；等服务端终态后再读取权威Conversation标题，避免与POST并发。 */
  await waitForUnavailableTurn(page);

  const firstConversationId = await page.evaluate(async () => {
    const response = await fetch('/api/v1/chat/conversations');
    const payload = (await response.json()) as {
      conversations: Array<{ id: string; title: string | null }>;
    };
    const current = payload.conversations.find(
      (conversation) => conversation.title === '第一本：机器视觉资料',
    );
    if (!current) throw new Error('第一本笔记本不存在');
    return current.id;
  });

  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
  // getDb 自 R 线起只从 internal subpath 导出（`@educanvas/db/internal`），默认入口不承载。
  const [dbModule, internalDbModule, drizzleModule] = await Promise.all([
    import('../../packages/db/src/index.ts'),
    import('../../packages/db/src/internal/index.ts'),
    import('../../packages/db/node_modules/drizzle-orm/index.js'),
  ]);
  const [conversation] = await internalDbModule
    .getDb()
    .select()
    .from(dbModule.conversations)
    .where(drizzleModule.eq(dbModule.conversations.id, firstConversationId))
    .limit(1);
  if (!conversation) throw new Error('第一本笔记本行不存在');

  const sourceBytes = await readFile(
    path.resolve('tests/fixtures/sample-1page.pdf'),
  );
  const storageKey = `e2e/${conversation.id}/notebook-source.pdf`;
  const storedPath = path.resolve(
    'output/playwright/object-storage',
    storageKey,
  );
  await mkdir(path.dirname(storedPath), { recursive: true });
  await writeFile(storedPath, sourceBytes);
  await new dbModule.DrizzleAssetRepository().createUploaded({
    ownerSubjectId: conversation.ownerSubjectId,
    spaceId: conversation.spaceId,
    scope: 'space',
    kind: 'document',
    displayName: '第一本视觉讲义.pdf',
    mimeType: 'application/pdf',
    byteSize: sourceBytes.byteLength,
    contentHash: createHash('sha256').update(sourceBytes).digest('hex'),
    storageKey,
    extractedText: '卷积神经网络可以提取图像特征。',
    outcome: { status: 'ready' },
  });
  const firstArtifact =
    await new dbModule.DrizzlePlatformArtifactRepository().createArtifact({
      spaceId: conversation.spaceId,
      trustedSubjectId: conversation.ownerSubjectId,
      kind: 'mind_map',
      trustTier: 'tier1',
      title: '第一本视觉导图',
    });

  await page.reload({ waitUntil: 'domcontentloaded' });
  let studio = await openStudioInput(page);
  await expect(studio.getByText('第一本视觉讲义.pdf')).toBeVisible({
    timeout: 15_000,
  });
  await closeStudio(page);
  studio = await openStudioOutput(page);
  await expect(studio.getByText('第一本视觉导图')).toBeVisible();
  await closeStudio(page);

  await createNotebook(
    page,
    (await openNotebookSidebar(page)).getByRole('button', {
      name: '新建笔记本',
    }),
    page
      .getByRole('region', { name: 'AI 对话' })
      .getByText(firstPrompt, { exact: true }),
  );
  studio = await openStudioInput(page);
  await expect(studio.getByText('第一本视觉讲义.pdf')).toHaveCount(0);
  await closeStudio(page);
  studio = await openStudioOutput(page);
  await expect(studio.getByText('第一本视觉导图')).toHaveCount(0);
  await closeStudio(page);
  await expect(
    page.evaluate(async (artifactId) => {
      const response = await fetch(`/api/v1/chat/artifacts/${artifactId}`);
      return response.status;
    }, firstArtifact.id),
  ).resolves.toBe(404);

  await (
    await openNotebookSidebar(page)
  )
    .getByRole('button', { name: /第一本：机器视觉资料/ })
    .click();
  studio = await openStudioInput(page);
  await expect(studio.getByText('第一本视觉讲义.pdf')).toBeVisible();
  await closeStudio(page);
  studio = await openStudioOutput(page);
  await expect(studio.getByText('第一本视觉导图')).toBeVisible();
});

test('Scripted：搜索并读取多个网页后，以稳定编号展示可打开的原文引用', async ({
  page,
}) => {
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
