import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  activeConversationId,
  appendVersions,
  closeCanvasAndWaitForFold,
  createArtifactFixture,
  createArtifactViaApi,
  createAudioOverviewFixture,
  ensureGeneralNotebook,
  openArtifactAndExpectLatest,
  openStudioOutput,
  waitForGenerationJobSucceeded,
} from './fixtures/general-artifact-fixture';

async function expectMindMapDragStopsOnRelease(
  page: Page,
  canvas: Locator,
) {
  const viewport = canvas.locator('[data-mind-map-viewport]');
  const map = viewport.locator('.mind-map-canvas');
  const box = await viewport.boundingBox();
  if (!box) throw new Error('思维导图 viewport 不可见');
  const transformBefore = await map.evaluate(
    (element) => element.style.transform,
  );
  const start = {
    x: box.x + Math.min(32, box.width / 4),
    y: box.y + Math.min(32, box.height / 4),
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 56, start.y + 42);
  const transformWhilePressed = await map.evaluate(
    (element) => element.style.transform,
  );
  expect(transformWhilePressed).not.toBe(transformBefore);

  await page.mouse.up();
  const transformAfterRelease = await map.evaluate(
    (element) => element.style.transform,
  );
  await page.mouse.move(start.x + 104, start.y + 78);
  await expect
    .poll(() => map.evaluate((element) => element.style.transform))
    .toBe(transformAfterRelease);
}

test('@smoke 通过 Fixture 验证思维导图在 Canvas 打开与断连恢复', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ensureGeneralNotebook(page);
  const fixture = await createArtifactFixture(page, 'mind_map', '对话思维导图');
  await appendVersions(page, fixture.artifactId, [
    {
      content: {
        contentVersion: 1,
        root: {
          id: 'root',
          label: '对话思维导图',
        },
      },
    },
  ]);
  await page.reload();

  await openArtifactAndExpectLatest(page, fixture.title);
  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible();
  await expect(
    canvas.locator('[data-mind-map]').getByText('对话思维导图'),
  ).toBeVisible();
  await expectMindMapDragStopsOnRelease(page, canvas);

  await closeCanvasAndWaitForFold(page);
  await page.reload();
  const studio = await openStudioOutput(page);
  await expect(studio.getByText(fixture.title)).toBeVisible();
  await expect(studio.getByText('v1')).toBeVisible();
});

test('API 创建产物链路由真实 worker 完成并可从 Studio 打开', async ({
  page,
}) => {
  await page.goto('/');
  await ensureGeneralNotebook(page);
  const title = `API 产物链路 ${Date.now()}`;
  const fixture = await createArtifactViaApi(page, 'mind_map', title);
  expect(fixture.jobId).toBeTruthy();
  expect(fixture.jobStatus).toBeTruthy();
  await waitForGenerationJobSucceeded(page, fixture.jobId);

  await page.reload();
  const studio = await openStudioOutput(page);
  await expect(studio.getByRole('button', { name: title })).toBeVisible({
    timeout: 40_000,
  });
  await studio.getByRole('button', { name: title }).click();
  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible({ timeout: 40_000 });
  await expect(canvas.getByRole('heading', { name: title })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    canvas.locator('[data-mind-map]').getByText('对话思维导图'),
  ).toBeVisible({
    timeout: 20_000,
  });
});

test('Studio 可切换意图并打开 Artifact 工作流', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ensureGeneralNotebook(page);
  const fixture = await createArtifactFixture(page, 'mind_map', '入口意图图谱');
  await appendVersions(page, fixture.artifactId, [
    {
      content: {
        contentVersion: 1,
        root: {
          id: 'root',
          label: '入口意图图谱',
        },
      },
    },
  ]);
  await page.reload();

  const studio = await openStudioOutput(page);
  const artifact = studio.getByRole('button', { name: /入口意图图谱/ });
  await expect(artifact).toBeVisible();
  await artifact.click();
  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible();
  await expect(
    canvas.locator('[data-mind-map]').getByText('入口意图图谱'),
  ).toBeVisible();
});

test('Canvas 可跨版本切换并验证历史可读', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ensureGeneralNotebook(page);
  const fixture = await createArtifactFixture(
    page,
    'mind_map',
    '版本可回退导图',
  );
  await appendVersions(page, fixture.artifactId, [
    {
      content: {
        contentVersion: 1,
        root: { id: 'root', label: '第一版：对话主题' },
      },
    },
    {
      content: {
        contentVersion: 1,
        root: { id: 'root', label: '第二版：对话主题（修订）' },
      },
    },
  ]);
  await page.reload();

  await openArtifactAndExpectLatest(page, fixture.title);
  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  const versionSelect = canvas.getByRole('combobox', { name: 'Canvas版本' });
  await expect(versionSelect).toHaveValue('2');
  await expect(
    canvas.locator('[data-mind-map]').getByText('第二版：对话主题（修订）'),
  ).toBeVisible();
  await versionSelect.selectOption('1');
  await expect(
    canvas.locator('[data-mind-map]').getByText('第一版：对话主题'),
  ).toBeVisible();
  await versionSelect.selectOption('2');
  await expect(
    canvas.locator('[data-mind-map]').getByText('第二版：对话主题（修订）'),
  ).toBeVisible();
  await closeCanvasAndWaitForFold(page);
  await page.reload();
  const studio = await openStudioOutput(page);
  await expect(studio.getByText('v2')).toBeVisible();
});

test('上传从空白入口建立笔记本来源，不把来源伪装成 Composer 工具', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '来源', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '添加来源' }).click();
  await page.getByRole('menuitem', { name: '上传文件' }).click();
  await expect(
    page.getByRole('dialog', { name: '上传文件' }),
  ).toBeVisible();
  await expect(
    page.getByText('文件会保存到当前笔记本的来源中，切换笔记本不会带走。'),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: '工作区主导航' }),
  ).toHaveCount(0);
  await page
    .getByRole('dialog', { name: '上传文件' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(
    page.getByRole('navigation', { name: '工作区主导航' }),
  ).toBeVisible();
});

test('Studio 打开 Slides fixture 后可分页浏览', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ensureGeneralNotebook(page);
  const fixture = await createArtifactFixture(
    page,
    'slides',
    '对话小结 Slides',
  );
  await appendVersions(page, fixture.artifactId, [
    {
      content: {
        contentVersion: 1,
        slides: [
          {
            id: 's1',
            title: '对话小结 Slides',
            bullets: ['要点一', '要点二'],
          },
          {
            id: 's2',
            title: '行动建议',
            bullets: ['复习与巩固'],
          },
        ],
      },
    },
  ]);
  await page.reload();

  await openArtifactAndExpectLatest(page, fixture.title);
  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible();
  await expect(
    canvas.getByRole('heading', { level: 3, name: '对话小结 Slides' }),
  ).toBeVisible();
  await expect(canvas.getByText('1 / 2')).toBeVisible();
});

test('Studio 打开闪卡 fixture 后可翻面自评且自评不上行', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ensureGeneralNotebook(page);
  const fixture = await createArtifactFixture(page, 'flashcards', '对话闪卡');
  await appendVersions(page, fixture.artifactId, [
    {
      content: {
        contentVersion: 1,
        cards: [
          {
            id: 'card-1',
            front: '什么是思维导图？',
            back: '用于归纳和组织知识点的树状结构图。',
          },
        ],
      },
    },
  ]);
  await page.reload();

  await openArtifactAndExpectLatest(page, fixture.title);
  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas.getByText('这次对话还没有可整理的问答')).toBeHidden();
  const versionSelect = canvas.getByRole('combobox', { name: 'Canvas版本' });
  await expect(versionSelect).toHaveValue('1');
  const card = canvas.getByText('什么是思维导图？');
  await expect(card).toBeVisible();
  await canvas.getByRole('button', { name: '显示答案' }).click();
  await expect(
    canvas.getByText('用于归纳和组织知识点的树状结构图。'),
  ).toBeVisible();
  await canvas.getByRole('button', { name: '记住了' }).click();
  await expect(
    canvas.getByText(/本轮完成[:：]\s*记住\s*1\s*\/\s*1/),
  ).toBeVisible();
  await expect(
    canvas.getByText('自评只保存在本页,不影响学习进度记录。'),
  ).toBeVisible();
});

test('Studio 可管理、编辑并恢复不可变版本笔记', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  await ensureGeneralNotebook(page);
  const fixture = await createArtifactFixture(page, 'note', '未命名笔记');
  await appendVersions(page, fixture.artifactId, [
    {
      content: {
        contentVersion: 1,
        markdown: '',
        sourceConversationId: fixture.conversationId,
        generatedByModel: false,
      },
      generatedBy: 'user:manual',
    },
    {
      content: {
        contentVersion: 1,
        markdown: '# 勾股定理\n\n直角三角形满足 $a^2+b^2=c^2$。',
        sourceConversationId: fixture.conversationId,
        generatedByModel: false,
      },
      generatedBy: 'user:manual',
    },
  ]);
  const studio = await openStudioOutput(page);
  const createdNote = studio.getByRole('button', { name: /^未命名笔记/ });
  await expect(createdNote).toContainText('v2');
  await createdNote.click();

  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible();
  await expect(canvas.getByText('勾股定理')).toBeVisible();
  await closeCanvasAndWaitForFold(page);
  await page.reload();
  const outputStudio = await openStudioOutput(page);
  const updatedNote = outputStudio.getByRole('button', { name: /^未命名笔记/ });
  await expect(updatedNote).toContainText('v2');
});

test('音频概览在恢复后可播放与文字稿', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ensureGeneralNotebook(page);
  const fixture = await createAudioOverviewFixture(page);

  await page.reload();
  await openArtifactAndExpectLatest(page, fixture.title);
  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  const audio = canvas.locator('audio[aria-label="播放音频概览"]');
  await expect(audio).toBeVisible();
  await expect(canvas.getByLabel('音频文字稿')).toContainText(
    '神经网络由多层神经元组成。',
  );

  const sourceUrl = await audio.getAttribute('src');
  expect(sourceUrl).toBeTruthy();
  const rangeResult = await page.evaluate(async (url) => {
    const response = await fetch(url!, {
      headers: { range: 'bytes=0-2' },
    });
    return {
      status: response.status,
      contentRange: response.headers.get('content-range'),
      byteLength: (await response.arrayBuffer()).byteLength,
    };
  }, sourceUrl);
  expect(rangeResult).toMatchObject({
    status: 206,
    byteLength: 3,
  });

  await closeCanvasAndWaitForFold(page);
  await page.reload();
  await openStudioOutput(page);
  await page.getByRole('button', { name: '音频来源概览' }).click();
  await expect(
    page
      .getByRole('dialog', { name: '产物Canvas' })
      .locator('audio[aria-label="播放音频概览"]'),
  ).toBeVisible();
});
