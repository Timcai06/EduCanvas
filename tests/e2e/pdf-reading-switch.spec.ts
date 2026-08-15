import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openLearningWorkspace } from './study-onboarding';

const ACTIVE_CONVERSATION_COOKIE = '__Host-educanvas_active_conversation';
const STUDIO_TRIGGER_NAME = '打开全部资源';
const PDF_FIXTURE = path.resolve('tests/fixtures/sample-1page.pdf');
const OBJECT_STORAGE_ROOT = path.resolve('output/playwright/object-storage');
const MD_TEXT = '# 网络编程讲义\n\nMinerU 结构化阅读验收内容。';

async function activeConversationId(page: Page): Promise<string> {
  const value = (await page.context().cookies()).find(
    (cookie) => cookie.name === ACTIVE_CONVERSATION_COOKIE,
  )?.value;
  if (!value) throw new Error('E2E 当前会话 Cookie 不存在');
  return value;
}

async function openStudioSource(page: Page) {
  await page.getByRole('button', { name: STUDIO_TRIGGER_NAME }).click();
  const studio = page.getByRole('region', {
    name: '当前笔记本的资源控制台',
  });
  await expect(studio).toBeVisible();
  await studio.getByRole('tab', { name: /^来源/ }).click();
  await expect(studio.getByRole('list', { name: '来源列表' })).toBeVisible();
  return studio;
}

/*
 * 注入一个带 structured 派生的 PDF 资产：原件 PDF 落对象存储，表示经
 * settleTextExtraction 写 structured + 派生 Markdown（与 Worker 成功路径
 * 同构）。webServer 只起 Next.js、无 graphile worker 进程，queued job 不会
 * 被领走，settle 结算不产生竞态。
 */
async function createPdfStructuredFixture(page: Page) {
  const conversationId = await activeConversationId(page);
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
    .where(drizzleModule.eq(dbModule.conversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new Error('E2E 当前会话行不存在');

  const pdfStorageKey = `assets/eeeeeeeeeeeeeeee/${randomUUID()}.pdf`;
  const pdfPath = path.join(OBJECT_STORAGE_ROOT, pdfStorageKey);
  await mkdir(path.dirname(pdfPath), { recursive: true });
  await copyFile(PDF_FIXTURE, pdfPath);
  const pdfStat = await stat(PDF_FIXTURE);
  /* contentHash 必须是对象真实 sha256：queued 资产会触发 Worker 的
     render_preview（校验对象内容与 content_hash 一致），占位 hash 会让
     后台任务失败并被 e2e worker 日志审计拦下。 */
  const pdfBytes = await readFile(PDF_FIXTURE);
  const pdfContentHash = createHash('sha256').update(pdfBytes).digest('hex');

  /* 派生对象布局与 Worker 一致：derived/<jobId>/index.md。 */
  const mdStorageKey = `derived/${randomUUID()}/index.md`;
  const mdPath = path.join(OBJECT_STORAGE_ROOT, mdStorageKey);
  await mkdir(path.dirname(mdPath), { recursive: true });
  await writeFile(mdPath, MD_TEXT, 'utf8');
  const checksum = createHash('sha256').update(MD_TEXT, 'utf8').digest('hex');

  const repo = new dbModule.DrizzleAssetRepository();
  const created = await repo.createUploadedPending({
    ownerSubjectId: conversation.ownerSubjectId,
    spaceId: conversation.spaceId,
    scope: 'space',
    kind: 'document',
    displayName: '网络编程.pdf',
    mimeType: 'application/pdf',
    byteSize: pdfStat.size,
    contentHash: pdfContentHash,
    storageKey: pdfStorageKey,
  });
  const settled = await repo.settleTextExtraction({
    jobId: created.jobId,
    outcome: {
      status: 'ready',
      extractedText: MD_TEXT,
      derivedStorageKey: mdStorageKey,
      checksum,
      quality: 'structured',
      mimeType: 'text/markdown',
    },
  });
  if (!settled) throw new Error('E2E 文本抽取结算失败');
  return { sourceId: created.snapshot.descriptor.assetId, conversationId };
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

/*
 * ADR-0026 决定 6 浏览器 smoke：真实浏览器中 PDF 默认保持原件预览（pdf.js），
 * structured 派生可用时提供显式切换；切换后显示 provenance 标注与派生
 * Markdown，不默认用派生顶替原件。
 */
test('@smoke PDF 结构化表示默认原件预览，显式切换结构化阅读', async ({
  page,
}) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ensureGeneralNotebook(page);
  const fixture = await createPdfStructuredFixture(page);
  await page.reload();

  const studio = await openStudioSource(page);
  const sourceResponse = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes(`/api/v1/canvas/resources/source/${fixture.sourceId}`) &&
      response.request().method() === 'GET',
  );
  await studio.getByRole('button', { name: /网络编程\.pdf/ }).click();
  expect((await sourceResponse).status()).toBe(200);

  const sourceCanvas = page.locator('[aria-label="来源预览"]');
  await expect(sourceCanvas).toBeVisible();
  /* 默认视图是原件：切换组存在且原件预览为按下态，pdf.js 渲染 canvas，
     派生 Markdown 不默认出现。 */
  await expect(
    sourceCanvas.getByRole('group', { name: '阅读视图切换' }),
  ).toBeVisible();
  await expect(
    sourceCanvas.getByRole('button', { name: '原件预览' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(sourceCanvas.locator('canvas')).toBeVisible({ timeout: 15_000 });
  await expect(sourceCanvas.getByRole('button', { name: '结构化阅读' }))
    .toBeVisible();
  await expect(sourceCanvas.getByText(MD_TEXT)).toHaveCount(0);

  /* 显式切换：provenance 标注 + 派生内容渲染。 */
  await sourceCanvas.getByRole('button', { name: '结构化阅读' }).click();
  await expect(sourceCanvas.getByText(/结构化阅读 · .* · 派生表示/))
    .toBeVisible();
  await expect(
    sourceCanvas.getByRole('heading', { name: '网络编程讲义' }),
  ).toBeVisible();
  await expect(sourceCanvas.getByText('MinerU 结构化阅读验收内容。'))
    .toBeVisible();

  /* 返回原件预览：pdf.js 重新出现。 */
  await sourceCanvas.getByRole('button', { name: '返回原件预览' }).click();
  await expect(sourceCanvas.locator('canvas')).toBeVisible({ timeout: 15_000 });
});
