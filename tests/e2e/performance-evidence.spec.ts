import { expect, test, type Page } from '@playwright/test';
import {
  STUDIO_TRIGGER_NAME,
  createMindMapArtifactFixture,
  ensureGeneralNotebook,
  openStudioOutput,
} from './fixtures/general-artifact-fixture';

/**
 * W06-4 性能证据：Canvas 打开无重复请求 + 交互耗时基线。
 *
 * W06 性能门禁（docs/plan/active/W-工作面画布收敛.md）：
 *  - 无新增 hydration warning → hydration.spec.ts（Q05，默认 lane 必跑）；
 *  - 关键 route bundle / 首次 JS 预算 → Q05 bundle-size gate
 *    （tooling/quality/bundle-size.mjs，CI 独立 job）；
 *  - 大型 Renderer 按需加载 → pdf-preview 走 `next/dynamic`（ssr:false），
 *    源码证据见 source-resource-renderer.tsx，不随首屏 bundle 加载；
 *  - 无重复请求 → 本 spec：打开产物时同一资源 URL 只请求一轮；
 *  - 交互耗时基线 → 本 spec 记录「打开→内容可见」耗时并写入台账，不作为
 *    断言阈值（避免以单次本机截图冒充性能结论）。
 */

/** 产物详情与资源验证的核心 URL 形态（打开资源的真实数据请求）。 */
const RESOURCE_REQUEST_PATTERN =
  /\/api\/v1\/chat\/artifacts\/[0-9a-f-]+$|\/api\/v1\/canvas\/resources\/artifact\/[0-9a-f-]+$/i;
const MIND_MAP_TITLE = '对话思维导图';

async function generateMindMap(page: Page) {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '今天想学什么？' }),
  ).toBeVisible();
  await ensureGeneralNotebook(page);
  await createMindMapArtifactFixture(page, MIND_MAP_TITLE);
  const studio = await openStudioOutput(page);
  await expect(
    studio.getByRole('button', { name: MIND_MAP_TITLE }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: STUDIO_TRIGGER_NAME }).click();
}

test('Canvas 打开产物时同一资源 URL 只请求一轮，关闭重开不累积重复', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await generateMindMap(page);

  // 记录资源数据请求 URL → 次数；断言每次打开期间同一 URL 不重复。
  const resourceRequests = new Map<string, number>();
  const requestStartedAt = Date.now();
  page.on('request', (request) => {
    const url = request.url();
    if (!RESOURCE_REQUEST_PATTERN.test(url)) return;
    const normalized = url.split('?')[0]!;
    resourceRequests.set(
      normalized,
      (resourceRequests.get(normalized) ?? 0) + 1,
    );
  });

  const openCanvas = async (): Promise<{ elapsedMs: number }> => {
    const start = Date.now();
    const studio = await openStudioOutput(page);
    await studio.getByRole('button', { name: /对话思维导图/ }).click();
    const canvas = page.getByRole('dialog', { name: '产物Canvas' });
    await expect(canvas).toBeVisible();
    await expect(
      canvas.locator('[data-mind-map]').getByText('对话思维导图'),
    ).toBeVisible();
    return { elapsedMs: Date.now() - start };
  };

  // 首次打开：每个资源 URL 恰好一轮，不因 React 严格模式/双挂载重复。
  const firstOpen = await openCanvas();
  for (const [url, count] of resourceRequests) {
    expect(count, `${url} 在首次打开期间应只请求一次（实际 ${count} 次）`).toBe(
      1,
    );
  }
  expect(resourceRequests.size).toBeGreaterThanOrEqual(1);

  // 关闭后重开：详情数据真实重拉（不依赖内存缓存），且仍每 URL 一轮。
  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await canvas.getByRole('button', { name: /关闭/ }).click();
  await expect(canvas).not.toBeVisible();
  const beforeReopen = new Map(resourceRequests);
  const reopen = await openCanvas();
  for (const [url, count] of resourceRequests) {
    const prior = beforeReopen.get(url) ?? 0;
    expect(
      count - prior,
      `${url} 在重开期间应只请求一次（实际 ${count - prior} 次）`,
    ).toBe(1);
  }

  // 交互耗时基线：记录并落台账，不在此断言阈值（本机数值不可跨环境对比）。
  const wallClock = Date.now() - requestStartedAt;
  console.log(
    `[perf-evidence] firstOpen=${firstOpen.elapsedMs}ms reopen=${reopen.elapsedMs}ms total=${wallClock}ms`,
  );
});
