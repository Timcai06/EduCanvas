import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STUDIO_TRIGGER_NAME = '展开当前笔记本的输入与输出';

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

/**
 * M1 验收场景:生成思维导图全链路
 * 对话 → 「+」菜单 → 确认卡 → 后台任务(真实 worker 进程消费)→ 产物卡 → Canvas 打开。
 * 不依赖模型 Provider:v1 大纲由 worker 规则生成,链路的每一环都是真实的。
 */
test('生成思维导图全链路经真实 worker 完成并可在 Canvas 打开', async ({
  page,
}) => {
  /* reduced-motion 下验证交互确定性；最终视觉由人工在真实页面验收。 */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '今天想学什么？' }),
  ).toBeVisible();

  /* 入口页经 pending 菜单动作创建对话,工作台挂载后自动打开确认卡 */
  await page.getByRole('button', { name: '添加上下文或创建内容' }).click();
  await page.getByRole('menuitem', { name: /生成思维导图/ }).click();

  const confirmSheet = page.getByRole('dialog', { name: '生成思维导图' });
  await expect(confirmSheet).toBeVisible();
  await confirmSheet.getByRole('button', { name: '开始生成' }).click();

  /* 后台任务由独立 worker 进程消费;30s 内应完成 */
  await expect(page.getByText('思维导图已生成')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: '打开', exact: true }).click();

  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible();
  await expect(
    canvas.locator('[data-mind-map]').getByText('对话思维导图'),
  ).toBeVisible();

  /* 断连恢复读取面:刷新后产物仍在当前笔记本的 Studio 中 */
  await canvas.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  const studio = await openStudioOutput(page);
  await expect(studio.getByText('对话思维导图')).toBeVisible();
  await expect(studio.getByText('v1')).toBeVisible();
});

test('Canvas 工具芯片随入口意图进入会话并自动打开本轮产物', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const canvasTool = page.getByRole('button', { name: 'Canvas', exact: true });
  await expect(canvasTool).toHaveAttribute('aria-pressed', 'false');
  await canvasTool.click();
  await expect(canvasTool).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: '添加上下文或创建内容' }).click();
  await page.getByRole('menuitem', { name: /生成思维导图/ }).click();
  const confirmSheet = page.getByRole('dialog', { name: '生成思维导图' });
  await expect(confirmSheet).toBeVisible();
  await confirmSheet.getByRole('button', { name: '开始生成' }).click();

  await expect(canvasTool).toHaveAttribute('aria-pressed', 'false');
  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(
    canvas.locator('[data-mind-map]').getByText('对话思维导图'),
  ).toBeVisible();
});

test('Canvas 可在同一产物上跨轮生成新版本并查看历史', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: '添加上下文或创建内容' }).click();
  await page.getByRole('menuitem', { name: /生成思维导图/ }).click();
  await page
    .getByRole('dialog', { name: '生成思维导图' })
    .getByRole('button', { name: '开始生成' })
    .click();
  await expect(page.getByText('思维导图已生成')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: '打开', exact: true }).click();

  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  const versionSelect = canvas.getByRole('combobox', { name: 'Canvas版本' });
  await expect(versionSelect).toHaveValue('1');
  await canvas
    .getByRole('textbox', { name: '告诉 AI 如何修改' })
    .fill('增加一个关于卷积层的分支');
  await canvas.getByRole('button', { name: '生成新版本' }).click();

  await expect(versionSelect).toHaveValue('2', { timeout: 30_000 });
  await expect(
    canvas
      .locator('[data-mind-map]')
      .getByText('修改：增加一个关于卷积层的分支'),
  ).toBeVisible();
  await versionSelect.selectOption('1');
  await expect(canvas.getByText('历史只读版本')).toBeVisible();
  await expect(
    canvas.getByRole('textbox', { name: '告诉 AI 如何修改' }),
  ).toBeDisabled();
  await expect(
    canvas
      .locator('[data-mind-map]')
      .getByText('修改：增加一个关于卷积层的分支'),
  ).toHaveCount(0);

  await versionSelect.selectOption('2');
  await expect(canvas.getByText('当前版本')).toBeVisible();
  await canvas.getByRole('button', { name: '关闭', exact: true }).click();
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
  await page.getByRole('button', { name: '添加上下文或创建内容' }).click();
  await page.getByRole('menuitem', { name: '上传文件' }).click();
  await expect(
    page.getByRole('dialog', { name: '添加文档来源' }),
  ).toBeVisible();
  await expect(
    page.getByText('文件会保存到当前笔记本的来源中，切换笔记本不会带走。'),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: '工作区主导航' }),
  ).toBeVisible();
});

test('生成 Slides 全链路并可分页浏览', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: '添加上下文或创建内容' }).click();
  await page.getByRole('menuitem', { name: /生成 Slides/ }).click();

  const confirmSheet = page.getByRole('dialog', { name: '生成Slides' });
  await expect(confirmSheet).toBeVisible();
  await confirmSheet.getByRole('button', { name: '开始生成' }).click();

  await expect(page.getByText('Slides已生成')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: '打开', exact: true }).click();

  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible();
  /* 规则版空对话 = 仅封面页(按 heading 级别定位,避开宿主标题重名) */
  await expect(
    canvas.getByRole('heading', { level: 3, name: '对话小结 Slides' }),
  ).toBeVisible();
  await expect(canvas.getByText('1 / 1')).toBeVisible();
});

test('生成闪卡全链路:翻面自评且自评不上行', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: '添加上下文或创建内容' }).click();
  await page.getByRole('menuitem', { name: /生成闪卡/ }).click();
  const confirmSheet = page.getByRole('dialog', { name: '生成闪卡' });
  await confirmSheet.getByRole('button', { name: '开始生成' }).click();
  await expect(page.getByText('闪卡已生成')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '打开', exact: true }).click();

  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  /* 空对话规则版 = 占位说明卡 */
  await expect(canvas.getByText('这次对话还没有可整理的问答')).toBeVisible();
  await canvas.getByRole('button', { name: '显示答案' }).click();
  await expect(canvas.getByText('先和 AI 聊几轮')).toBeVisible();
  await canvas.getByRole('button', { name: '记住了' }).click();
  await expect(canvas.getByText('本轮完成:记住 1 / 1')).toBeVisible();
  await expect(canvas.getByText('不影响学习进度记录')).toBeVisible();
});

test('Studio 可管理、编辑并恢复不可变版本笔记', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  /* 空入口尚未建立 Notebook；打开一次真实上传入口完成本地身份与会话引导。 */
  await page.getByRole('button', { name: '添加上下文或创建内容' }).click();
  await page.getByRole('menuitem', { name: '上传文件' }).click();
  await page
    .getByRole('dialog', { name: '添加文档来源' })
    .getByRole('button', { name: '关闭' })
    .click();
  const created = await page.evaluate(async () => {
    const response = await fetch('/api/v1/chat/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'note',
        title: '未命名笔记',
        markdown: '',
      }),
    });
    return { ok: response.ok, status: response.status };
  });
  expect(created).toEqual({ ok: true, status: 201 });
  const studio = await openStudioOutput(page);
  const createdNote = studio.getByRole('option', { name: /^未命名笔记/ });
  await expect(createdNote.getByText('v1', { exact: true })).toBeVisible();
  await createdNote.click();

  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible();
  await canvas.getByRole('button', { name: '编辑', exact: true }).click();
  await canvas
    .getByRole('textbox', { name: '笔记编辑区' })
    .fill('# 勾股定理\n\n直角三角形满足 $a^2+b^2=c^2$。');
  const versionSelect = canvas.getByRole('combobox', { name: 'Canvas版本' });
  await expect(versionSelect).toHaveValue('2', { timeout: 10_000 });
  await expect(canvas.getByText('勾股定理')).toBeVisible();

  await canvas.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  const outputStudio = await openStudioOutput(page);
  const updatedNote = outputStudio.getByRole('option', {
    name: /^未命名笔记/,
  });
  await expect(updatedNote.getByText('v2', { exact: true })).toBeVisible();
  await updatedNote.click();
  await expect(
    page.getByRole('dialog', { name: '产物Canvas' }).getByText('勾股定理'),
  ).toBeVisible();
});

test('音频概览冻结勾选来源，断线后可恢复播放与文字稿', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: '添加上下文或创建内容' }).click();
  await page.getByRole('menuitem', { name: /生成音频概览/ }).click();

  const emptyConfirm = page.getByRole('dialog', { name: '生成音频概览' });
  await expect(
    emptyConfirm.getByText('请先在来源面板勾选至少一项'),
  ).toBeVisible();
  await expect(
    emptyConfirm.getByRole('button', { name: '开始生成' }),
  ).toBeDisabled();
  await emptyConfirm.getByRole('button', { name: '关闭' }).click();

  const conversationId = await page.evaluate(async () => {
    const response = await fetch('/api/v1/chat/conversations');
    const payload = (await response.json()) as {
      conversations: Array<{ id: string }>;
    };
    const current = payload.conversations[0];
    if (!current) throw new Error('E2E 当前会话不存在');
    return current.id;
  });
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
  // getDb 自 R 线起只从 internal subpath 导出（`@educanvas/db/internal`），默认入口不承载。
  const [{ DrizzleAssetRepository, conversations }, { getDb }, { eq }] =
    await Promise.all([
      import('../../packages/db/src/index.ts'),
      import('../../packages/db/src/internal/index.ts'),
      import('../../packages/db/node_modules/drizzle-orm/index.js'),
    ]);
  const [conversation] = await getDb()
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new Error('E2E 会话行不存在');
  const sourceBytes = await readFile(
    path.resolve('tests/fixtures/sample-1page.pdf'),
  );
  const storageKey = `e2e/${conversation.id}/audio-source.pdf`;
  const storedPath = path.resolve(
    'output/playwright/object-storage',
    storageKey,
  );
  await mkdir(path.dirname(storedPath), { recursive: true });
  await writeFile(storedPath, sourceBytes);
  await new DrizzleAssetRepository().createUploaded({
    ownerSubjectId: conversation.ownerSubjectId,
    spaceId: conversation.spaceId,
    scope: 'space',
    kind: 'document',
    displayName: '音频来源讲义.pdf',
    mimeType: 'application/pdf',
    byteSize: sourceBytes.byteLength,
    contentHash: createHash('sha256').update(sourceBytes).digest('hex'),
    storageKey,
    extractedText: '神经网络由多层神经元组成，训练通过误差更新权重。',
    outcome: { status: 'ready' },
  });

  await page.reload();
  const inputStudio = await openStudioInput(page);
  const source = inputStudio.getByRole('option', {
    name: /音频来源讲义\.pdf/,
  });
  await expect(source.getByText('已用于对话', { exact: true })).toBeVisible();
  await closeStudio(page);
  await page.getByRole('button', { name: '添加上下文或创建内容' }).click();
  await page.getByRole('menuitem', { name: /生成音频概览/ }).click();
  const confirm = page.getByRole('dialog', { name: '生成音频概览' });
  await expect(confirm.getByText('当前勾选的 1 项')).toBeVisible();
  await confirm.getByRole('button', { name: '开始生成' }).click();

  await expect(page.getByText('音频概览已生成')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: '打开', exact: true }).click();
  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  const audio = canvas.locator('audio[aria-label="播放音频概览"]');
  await expect(audio).toBeVisible();
  await expect(canvas.getByLabel('音频文字稿')).toContainText(
    '神经网络由多层神经元组成',
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
    contentRange: 'bytes 0-2/8',
    byteLength: 3,
  });

  await canvas.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  const studio = await openStudioOutput(page);
  await studio.getByRole('option', { name: /来源音频概览/ }).click();
  await expect(
    page
      .getByRole('dialog', { name: '产物Canvas' })
      .locator('audio[aria-label="播放音频概览"]'),
  ).toBeVisible();
});
