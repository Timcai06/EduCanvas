import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const ACTIVE_CONVERSATION_COOKIE = '__Host-educanvas_active_conversation';
const STUDIO_TRIGGER_NAME = '打开全部资源';
const TEXT_FIXTURE = path.resolve('tests/fixtures/sample.txt');
const OBJECT_STORAGE_ROOT = path.resolve('output/playwright/object-storage');

async function activeConversationId(page: Page): Promise<string> {
  const value = (await page.context().cookies()).find(
    (cookie) => cookie.name === ACTIVE_CONVERSATION_COOKIE,
  )?.value;
  if (!value) throw new Error('E2E 当前会话 Cookie 不存在');
  return value;
}

/* 用 DOM 属性定位而非 getByRole：抽屉收起时 aria-hidden+inert 会把 aside
   移出可访问性树，role 定位器计数为 0（实验已验证），状态探测全部落空。 */
function notebookSidebar(page: Page) {
  return page.locator('aside[aria-label="笔记本侧栏"]');
}

async function openNotebookSidebar(page: Page) {
  const sidebar = notebookSidebar(page);
  if ((await sidebar.getAttribute('aria-hidden')) === 'true') {
    await page.getByRole('button', { name: '打开笔记本列表' }).click();
  }
  await expect(sidebar).toHaveAttribute('aria-hidden', 'false');
  return sidebar;
}

async function openStudio(page: Page, kind: 'source' | 'artifact') {
  await page.getByRole('button', { name: STUDIO_TRIGGER_NAME }).click();
  const studio = page.getByRole('region', {
    name: '当前笔记本的资源控制台',
  });
  await expect(studio).toBeVisible();
  const label = kind === 'source' ? '来源' : '输出';
  await studio.getByRole('tab', { name: new RegExp(`^${label}`) }).click();
  await expect(
    studio.getByRole('list', {
      name: kind === 'source' ? '来源列表' : '输出列表',
    }),
  ).toBeVisible();
  return studio;
}

async function createResourceFixtures(page: Page) {
  const conversationId = await activeConversationId(page);
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
  // getDb 自 R 线起只从 internal subpath 导出（`@educanvas/db/internal`），默认入口不承载。
  const [dbModule, testingDbModule] = await Promise.all([
    import('@educanvas/db'),
    import('@educanvas/db/testing'),
  ]);
  const internalDbModule = testingDbModule;
  const drizzleModule = testingDbModule;
  const [conversation] = await internalDbModule
    .getDb()
    .select()
    .from(dbModule.conversations)
    .where(drizzleModule.eq(dbModule.conversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new Error('E2E 当前会话行不存在');

  const storageKey = `assets/eeeeeeeeeeeeeeee/${randomUUID()}.txt`;
  const storedPath = path.join(OBJECT_STORAGE_ROOT, storageKey);
  await mkdir(path.dirname(storedPath), { recursive: true });
  await copyFile(TEXT_FIXTURE, storedPath);
  const fixtureStat = await stat(TEXT_FIXTURE);
  const source = await new dbModule.DrizzleAssetRepository().createUploaded({
    ownerSubjectId: conversation.ownerSubjectId,
    spaceId: conversation.spaceId,
    scope: 'space',
    kind: 'document',
    displayName: 'S1 文本来源.txt',
    mimeType: 'text/plain',
    byteSize: fixtureStat.size,
    contentHash: 'd'.repeat(64),
    storageKey,
    extractedText: 'S1 Canvas 资源访问验收。',
    outcome: { status: 'ready' },
  });

  const artifacts = new dbModule.DrizzlePlatformArtifactRepository();
  const artifact = await artifacts.createArtifact({
    spaceId: conversation.spaceId,
    conversationId,
    trustedSubjectId: conversation.ownerSubjectId,
    kind: 'mind_map',
    trustTier: 'tier1',
    title: 'S1 版本恢复导图',
  });
  await artifacts.appendVersion({
    artifactId: artifact.id,
    trustedSubjectId: conversation.ownerSubjectId,
    generatedBy: 'e2e:canvas-resource:v1',
    content: {
      contentVersion: 1,
      root: { id: 'root', label: 'S1 第一版' },
    },
  });
  await artifacts.appendVersion({
    artifactId: artifact.id,
    trustedSubjectId: conversation.ownerSubjectId,
    generatedBy: 'e2e:canvas-resource:v2',
    content: {
      contentVersion: 1,
      root: { id: 'root', label: 'S1 第二版' },
    },
  });
  return {
    sourceId: source.descriptor.assetId,
    artifactId: artifact.id,
    conversationId,
  };
}

async function responseStatus(page: Page, url: string): Promise<number> {
  return page.evaluate(async (resourceUrl) => {
    const response = await fetch(resourceUrl);
    return response.status;
  }, url);
}

async function ensureGeneralNotebook(page: Page) {
  await page.getByRole('button', { name: '添加来源' }).click();
  await page.getByRole('menuitem', { name: '上传文件' }).click();
  await page
    .getByRole('dialog', { name: '添加文档来源' })
    .getByRole('button', { name: '关闭' })
    .click();
  await expect.poll(() => activeConversationId(page)).toBeTruthy();
}

test('@smoke 统一 endpoint 打开 Source/Artifact，并隔离 Notebook、用户与版本', async ({
  browser,
  page,
}) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ensureGeneralNotebook(page);
  const fixture = await createResourceFixtures(page);
  const notebookTitle = `S1 Canvas 资源笔记本 ${fixture.conversationId.slice(0, 8)}`;
  await page.evaluate(
    async ({ conversationId, title }) => {
      const response = await fetch(
        `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title }),
        },
      );
      if (!response.ok) throw new Error('E2E 笔记本命名失败');
    },
    { conversationId: fixture.conversationId, title: notebookTitle },
  );
  await page.reload();

  let studio = await openStudio(page, 'source');
  const sourceResponse = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes(`/api/v1/canvas/resources/source/${fixture.sourceId}`) &&
      response.request().method() === 'GET',
  );
  await studio.getByRole('button', { name: /S1 文本来源\.txt/ }).click();
  expect((await sourceResponse).status()).toBe(200);
  const sourceCanvas = page.locator('[aria-label="来源预览"]');
  await expect(sourceCanvas).toBeVisible();
  await expect(
    sourceCanvas.getByRole('heading', { name: 'S1 文本来源.txt' }),
  ).toBeVisible();
  await sourceCanvas.getByRole('button', { name: '关闭来源预览' }).click();

  studio = await openStudio(page, 'artifact');
  const artifactResponse = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes(`/api/v1/canvas/resources/artifact/${fixture.artifactId}`) &&
      response.request().method() === 'GET',
  );
  await studio.getByRole('button', { name: /S1 版本恢复导图/ }).click();
  expect((await artifactResponse).status()).toBe(200);
  const artifactCanvas = page.locator('[aria-label="产物Canvas"]');
  const versions = artifactCanvas.getByRole('combobox', {
    name: 'Canvas版本',
  });
  await expect(versions).toHaveValue('2');
  await expect(artifactCanvas.getByText('S1 第二版')).toBeVisible();
  await versions.selectOption('1');
  await expect(artifactCanvas.getByText('S1 第一版')).toBeVisible();
  await versions.selectOption('2');
  await expect(artifactCanvas.getByText('S1 第二版')).toBeVisible();

  expect(
    await responseStatus(
      page,
      `/api/v1/chat/assets/${fixture.sourceId}/preview`,
    ),
  ).toBe(200);
  expect(
    await responseStatus(page, `/api/v1/chat/artifacts/${fixture.artifactId}`),
  ).toBe(200);
  await artifactCanvas
    .getByRole('button', { name: '关闭', exact: true })
    .click();

  const previousConversationId = await activeConversationId(page);
  const sidebar = await openNotebookSidebar(page);
  await sidebar.getByRole('button', { name: '新建笔记本' }).click();
  await expect
    .poll(() => activeConversationId(page))
    .not.toBe(previousConversationId);
  await expect(page.locator('[aria-label="产物Canvas"]')).toHaveCount(0);
  const crossNotebookStatuses = {
    sourceResource: await responseStatus(
      page,
      `/api/v1/canvas/resources/source/${fixture.sourceId}`,
    ),
    artifactResource: await responseStatus(
      page,
      `/api/v1/canvas/resources/artifact/${fixture.artifactId}`,
    ),
    legacySource: await responseStatus(
      page,
      `/api/v1/chat/assets/${fixture.sourceId}/preview`,
    ),
    legacyArtifact: await responseStatus(
      page,
      `/api/v1/chat/artifacts/${fixture.artifactId}`,
    ),
  };
  expect(crossNotebookStatuses).toEqual({
    sourceResource: 404,
    artifactResource: 404,
    legacySource: 404,
    legacyArtifact: 404,
  });

  const strangerContext = await browser.newContext();
  try {
    const strangerPage = await strangerContext.newPage();
    await strangerPage.goto('/');
    await ensureGeneralNotebook(strangerPage);
    expect(
      await responseStatus(
        strangerPage,
        `/api/v1/canvas/resources/source/${fixture.sourceId}`,
      ),
    ).toBe(404);
    expect(
      await responseStatus(
        strangerPage,
        `/api/v1/canvas/resources/artifact/${fixture.artifactId}`,
      ),
    ).toBe(404);
  } finally {
    await strangerContext.close();
  }

  const firstNotebook = await openNotebookSidebar(page);
  await firstNotebook
    .getByRole('button', { name: new RegExp(notebookTitle) })
    .click();
  await expect
    .poll(() => activeConversationId(page))
    .toBe(fixture.conversationId);
  expect(
    await responseStatus(
      page,
      `/api/v1/canvas/resources/artifact/${fixture.artifactId}`,
    ),
  ).toBe(200);
});
