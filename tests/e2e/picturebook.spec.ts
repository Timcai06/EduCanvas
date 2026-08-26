import { expect, test, type Page } from '@playwright/test';
import {
  createPicturebookArtifactFixture,
  ensureGeneralNotebook,
  openArtifactAndExpectLatest,
} from './fixtures/general-artifact-fixture';

async function mockPicturebookImages(page: Page) {
  await page.route('**/picturebook/pages/*?version=1', async (route) => {
    const pageNumber = Number(
      new URL(route.request().url()).pathname.split('/').at(-1),
    );
    const colors = ['#DCECCB', '#F8DEB5', '#CFE8F3', '#F6C9B8'];
    const fill = colors[(pageNumber - 1) % colors.length];
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${fill}"/><circle cx="400" cy="270" r="145" fill="#F28C5B"/><circle cx="345" cy="235" r="14" fill="#2F3B32"/><circle cx="455" cy="235" r="14" fill="#2F3B32"/><path d="M350 330 Q400 365 450 330" fill="none" stroke="#2F3B32" stroke-width="12" stroke-linecap="round"/><text x="400" y="520" text-anchor="middle" font-size="34" fill="#2F3B32">PAGE ${pageNumber}</text></svg>`,
    });
  });
}

async function openPicturebook(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockPicturebookImages(page);
  await page.goto('/');
  await ensureGeneralNotebook(page);
  const fixture = await createPicturebookArtifactFixture(
    page,
    '小狐狸认识平均数',
  );
  await page.reload();
  await openArtifactAndExpectLatest(page, fixture.title);
  return page.getByRole('region', { name: `${fixture.title} 绘本` });
}

test('@ui picturebook turns pages with buttons and keyboard', async ({
  page,
}, testInfo) => {
  const book = await openPicturebook(page);
  await expect(book).toContainText('第 1 页 / 共 6 页');
  await expect(book).toContainText('森林里，小狐狸收集了三篮松果。');
  await expect(page.getByRole('button', { name: '上一页' })).toBeDisabled();

  await page.getByRole('button', { name: '下一页' }).click();
  await expect(book).toContainText('第 2 页 / 共 6 页');
  await book.focus();
  await page.keyboard.press('ArrowRight');
  await expect(book).toContainText('第 3 页 / 共 6 页');
  const screenshot = await book.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('picturebook-page.png'),
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
});

test('@ui picturebook stays inside a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const book = await openPicturebook(page);

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  await expect(book.getByRole('button', { name: '下一页' })).toBeVisible();
});
