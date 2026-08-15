import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ACTIVE_CONVERSATION_COOKIE = '__Host-educanvas_active_conversation';
const STUDIO_TRIGGER_NAME = '打开全部资源';

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
  const studio = page.getByRole('region', {
    name: '当前笔记本的资源控制台',
  });
  await expect(studio).toBeVisible();
  await studio.getByRole('tab', { name: /^来源/ }).click();
  await expect(studio.getByRole('list', { name: '来源列表' })).toBeVisible();
  return studio;
}

async function openStudioOutput(page: Page) {
  await page.getByRole('button', { name: STUDIO_TRIGGER_NAME }).click();
  const studio = page.getByRole('region', {
    name: '当前笔记本的资源控制台',
  });
  await expect(studio).toBeVisible();
  await studio.getByRole('tab', { name: /^输出/ }).click();
  await expect(studio.getByRole('list', { name: '输出列表' })).toBeVisible();
  return studio;
}

async function closeStudio(page: Page) {
  await page.getByRole('button', { name: '返回对话页面' }).click();
  await expect(
    page.getByRole('region', { name: '当前笔记本的资源控制台' }),
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
