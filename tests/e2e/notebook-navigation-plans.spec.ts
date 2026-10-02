import { expect, test, type Page } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import {
  activeConversationId,
  ensureGeneralNotebook,
  createArtifactFixture,
  appendVersions,
} from './fixtures/general-artifact-fixture';
import { completeStudyOnboarding } from './study-onboarding';
import { openNotebookSidebar } from './helpers/journey-helpers';

interface ConversationDirectory {
  conversations: { id: string; spaceId: string; agentProfileId: string }[];
}

/** Browser fetch preserves production Secure/HttpOnly identity cookies on the loopback origin. */
async function readBrowserJson(page: Page, url: string) {
  return page.evaluate(async (path) => {
    const response = await fetch(path, { cache: 'no-store' });
    return {
      status: response.status,
      body: (await response.json()) as unknown,
    };
  }, url);
}

async function readNotebookConversations(
  page: Page,
  notebookId: string,
): Promise<ConversationDirectory['conversations']> {
  const result = await readBrowserJson(
    page,
    `/api/v1/notebooks/${notebookId}/conversations`,
  );
  expect(result.status, 'authenticated Notebook directory request').toBe(200);
  expect(result.body).toHaveProperty('conversations');
  const directory = result.body as ConversationDirectory;
  expect(Array.isArray(directory.conversations)).toBe(true);
  for (const conversation of directory.conversations) {
    expect(conversation.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(conversation.spaceId).toBe(notebookId);
    expect(typeof conversation.agentProfileId).toBe('string');
  }
  return directory.conversations;
}

test('Notebook URLs preserve multiple conversations and real source plans', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ensureGeneralNotebook(page);
  await expect(page).toHaveURL(
    /\/notebook\/[0-9a-f-]+\/conversation\/[0-9a-f-]+/,
  );
  const initialConversationId = await activeConversationId(page);
  const notebookId = new URL(page.url()).pathname.split('/')[2]!;
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
  const { DrizzleAssetRepository, DrizzleGatewayHandoffRepository } =
    await import('@educanvas/db');
  const { getDb, conversations, eq } = await import('@educanvas/db/testing');
  const [conversation] = await getDb()
    .select()
    .from(conversations)
    .where(eq(conversations.id, initialConversationId))
    .limit(1);
  if (!conversation) throw new Error('Notebook fixture missing');
  const sourceText = '第一章 分数。第二章 几何。';
  const sourceFixture = await new DrizzleAssetRepository().createUploaded({
    ownerSubjectId: conversation.ownerSubjectId,
    spaceId: notebookId,
    scope: 'space',
    kind: 'document',
    displayName: '学习资料.txt',
    mimeType: 'text/plain',
    byteSize: Buffer.byteLength(sourceText),
    contentHash: createHash('sha256').update(sourceText).digest('hex'),
    storageKey: `e2e/notebook/${initialConversationId}/source.txt`,
    extractedText: sourceText,
    outcome: { status: 'ready' },
  });
  const sidebarToggle = page.locator('[aria-controls="conversation-sidebar"]');
  await expect(sidebarToggle).toHaveAttribute('aria-expanded', /true|false/);
  if ((await sidebarToggle.getAttribute('aria-expanded')) === 'false')
    await sidebarToggle.click();
  await expect(page.locator('#conversation-sidebar')).toHaveAttribute(
    'aria-hidden',
    'false',
  );
  await page.getByRole('button', { name: '新建对话', exact: true }).click();
  await expect(page).not.toHaveURL(
    new RegExp(`/conversation/${initialConversationId}$`),
  );
  await expect(page).toHaveURL(
    new RegExp(`/notebook/${notebookId}/conversation/`),
  );
  const childConversationId = new URL(page.url()).pathname.split('/')[4]!;
  await page.goto(`/notebook/${notebookId}/plans`);
  await expect(page.getByRole('heading', { name: '创建小计划' })).toBeVisible();
  await page
    .getByLabel('选择对话', { exact: true })
    .selectOption(initialConversationId);
  await page.getByLabel('计划标题', { exact: true }).fill('整理分数讨论');
  await page.getByRole('button', { name: '创建计划', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '整理分数讨论' }),
  ).toBeVisible();
  await page
    .getByLabel('资料', { exact: true })
    .selectOption({ label: '学习资料.txt' });
  await page.getByLabel('分组名称', { exact: true }).fill('用户确认的整份讲义');
  await page.getByRole('button', { name: '保存资料分组', exact: true }).click();
  await page.getByLabel('计划来源', { exact: true }).selectOption('chapter');
  await expect(
    page
      .getByLabel('选择资料分组', { exact: true })
      .getByRole('option', { name: '用户确认的整份讲义' }),
  ).toBeAttached();
  await page
    .getByLabel('选择资料分组', { exact: true })
    .selectOption({ label: '用户确认的整份讲义' });
  await page.getByLabel('计划标题', { exact: true }).fill('阅读资料第一轮');
  await page.getByRole('button', { name: '创建计划', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '阅读资料第一轮' }),
  ).toBeVisible();
  await page.getByLabel('计划来源', { exact: true }).selectOption('purpose');
  await page
    .getByLabel('学习目的', { exact: true })
    .fill('能用自己的话解释分数');
  await page.getByLabel('计划标题', { exact: true }).fill('目的练习');
  await page.getByRole('button', { name: '创建计划', exact: true }).click();
  const purpose = page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name: '目的练习', exact: true }),
  });
  await purpose.getByRole('button', { name: '标记完成' }).click();
  await expect(purpose.getByText('已完成', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '阅读资料第一轮' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '整理分数讨论' }),
  ).toBeVisible();
  const directory = await readNotebookConversations(page, notebookId);
  expect(directory.map((item) => item.id).sort()).toEqual(
    [initialConversationId, childConversationId].sort(),
  );
  await page.getByRole('link', { name: '建立总学习目标' }).click();
  await expect(page).toHaveURL(new RegExp(`/notebook/${notebookId}/learn$`));
  await expect(
    page.getByRole('heading', { name: '今天想学会什么？', exact: true }),
  ).toBeVisible();
  await completeStudyOnboarding(page);
  await expect(page).toHaveURL(new RegExp(`/notebook/${notebookId}/learn$`));
  await page.getByRole('link', { name: '返回笔记本', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/notebook/${notebookId}/plans$`));
  await expect(page.getByRole('link', { name: '继续课程学习' })).toBeVisible();
  await page.goto('/learn');
  await expect(page).toHaveURL(new RegExp(`/notebook/${notebookId}/learn$`));
  const courseDirectory = await readNotebookConversations(page, notebookId);
  const teachers = courseDirectory.filter(
    (item) => item.agentProfileId === 'k12.teacher',
  );
  expect(teachers).toHaveLength(1);
  const teacherConversationId = teachers[0]!.id;
  const sourceToken = randomBytes(32).toString('base64url');
  await new DrizzleGatewayHandoffRepository().issue({
    tokenDigest: createHash('sha256').update(sourceToken).digest('hex'),
    userId: conversation.ownerSubjectId,
    conversationId: teacherConversationId,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
    target: {
      kind: 'resource',
      resourceKind: 'source',
      resourceId: sourceFixture.descriptor.assetId,
      versionId: null,
    },
  });
  await page.goto(`/open?token=${sourceToken}`);
  await expect(page).toHaveURL(
    new RegExp(
      `/notebook/${notebookId}/learn\\?focus=source:${sourceFixture.descriptor.assetId}&conversation=${teacherConversationId}`,
    ),
  );
  await expect(page.getByRole('dialog', { name: '来源预览' })).toBeVisible();
  await expect(page.getByText(sourceText, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭来源预览', exact: true }).click();
  const handoffArtifact = await createArtifactFixture(
    page,
    'note',
    '课程交接笔记',
  );
  await appendVersions(page, handoffArtifact.artifactId, [
    {
      content: {
        contentVersion: 1,
        generatedByModel: false,
        sourceConversationId: handoffArtifact.conversationId,
        markdown: '精确交接目标的笔记正文。',
      },
    },
  ]);
  const artifactToken = randomBytes(32).toString('base64url');
  await new DrizzleGatewayHandoffRepository().issue({
    tokenDigest: createHash('sha256').update(artifactToken).digest('hex'),
    userId: conversation.ownerSubjectId,
    conversationId: teacherConversationId,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
    target: {
      kind: 'artifact',
      artifactId: handoffArtifact.artifactId,
      versionId: null,
    },
  });
  await page.goto(`/open?token=${artifactToken}`);
  await expect(page).toHaveURL(
    new RegExp(
      `/notebook/${notebookId}/learn\\?focus=artifact:${handoffArtifact.artifactId}&conversation=${teacherConversationId}`,
    ),
  );
  await expect(
    page.getByRole('dialog', { name: '交接产物预览' }),
  ).toBeVisible();
  await expect(
    page.getByText('精确交接目标的笔记正文。', { exact: true }),
  ).toBeVisible();
});

test('two learning notebooks freeze their own request scope across shared cookies', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ensureGeneralNotebook(page);
  await expect(page).toHaveURL(
    /\/notebook\/[0-9a-f-]+\/conversation\/[0-9a-f-]+/,
  );
  const notebookA = new URL(page.url()).pathname.split('/')[2]!;
  await page.goto(`/notebook/${notebookA}/learn`);
  await completeStudyOnboarding(page);
  await page.goto(`/notebook/${notebookA}/plans`);
  await page.getByRole('button', { name: '新建笔记本', exact: true }).click();
  await expect(page).toHaveURL(
    /\/notebook\/[0-9a-f-]+\/conversation\/[0-9a-f-]+/,
  );
  const notebookB = new URL(page.url()).pathname.split('/')[2]!;
  expect(notebookB).not.toBe(notebookA);
  // URL 先于 Server Action 重定向完成更新；待新工作区挂载后再发起下一次导航。
  await openNotebookSidebar(page);
  await page.goto(`/notebook/${notebookB}/learn`);
  await completeStudyOnboarding(page);
  const tabA = await page.context().newPage();
  await tabA.emulateMedia({ reducedMotion: 'reduce' });
  await tabA.goto(`/notebook/${notebookA}/learn`);
  const requests: URL[] = [];
  await tabA.route('**/api/v1/learn/turn**', async (route) => {
    requests.push(new URL(route.request().url()));
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'provider_unavailable' } }),
    });
  });
  const composer = tabA.getByRole('textbox', { name: '向 EduCanvas 提问' });
  await expect(composer).toBeVisible();
  await composer.fill('验证这本笔记本的请求范围');
  await composer.press('Enter');
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]!.searchParams.get('requestNotebookId')).toBe(notebookA);
  expect(requests[0]!.searchParams.get('requestConversationId')).toMatch(
    /^[0-9a-f-]{36}$/,
  );
  const conversationA = requests[0]!.searchParams.get('requestConversationId')!;
  const conversationsA = await readNotebookConversations(tabA, notebookA);
  const conversationsB = await readNotebookConversations(page, notebookB);
  expect(
    conversationsA.find((item) => item.id === conversationA)?.agentProfileId,
  ).toBe('k12.teacher');
  expect(
    conversationsB.filter((item) => item.agentProfileId === 'k12.teacher'),
  ).toHaveLength(1);
  expect(conversationsB.map((item) => item.id)).not.toContain(conversationA);
  const assetsA = await readBrowserJson(
    page,
    `/api/v1/chat/assets?requestNotebookId=${notebookA}&requestConversationId=${conversationA}`,
  );
  expect(assetsA.status).toBe(200);
  expect(assetsA.body).toHaveProperty('assets');
  const invalid = await readBrowserJson(
    page,
    `/api/v1/chat/assets?requestNotebookId=${notebookB}&requestConversationId=${conversationA}`,
  );
  expect(invalid.status).toBe(404);
  await tabA.close();
});
