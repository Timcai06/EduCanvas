import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'E2E_DATABASE_URL 未设置；Playwright 必须使用独立的浏览器测试数据库',
  );
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!databaseName.endsWith('_e2e') && !databaseName.endsWith('_test')) {
  throw new Error(
    'E2E 数据库名必须以 _e2e 或 _test 结尾，拒绝连接开发共享库或生产库',
  );
}

const port = Number(process.env.PLAYWRIGHT_PORT ?? '3100');
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const objectStorageRoot = path.resolve('output/playwright/object-storage');

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: [
    '**/web-runtime-composition.spec.ts',
    '**/web-runtime-stress.spec.ts',
  ],
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  // UI appearance, responsive layout, focus choreography and motion checks are
  // owned by the UI review lane. Default CI keeps only product, data and
  // security behavior so visual QA cannot block unrelated delivery.
  grepInvert: /@ui/,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  outputDir: 'output/playwright/test-results',
  reporter: [
    ['line'],
    [
      'html',
      {
        open: 'never',
        outputFolder: 'output/playwright/report',
      },
    ],
    // Q05：CI 下输出 JSON 结果，供 tooling/quality/playwright-summary.mjs
    // 汇总 retry/flaky 与覆盖矩阵写入 GITHUB_STEP_SUMMARY。
    ...(process.env.CI
      ? [['json', { outputFile: 'output/playwright/results.json' }] as const]
      : []),
  ],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Q05：移动 viewport 进入稳定 lane（第二 device 环境）。
    // 与 desktop 同一浏览器内核，不新增 CI 浏览器安装；
    // 响应式回归由本 project 在每次 PR 必跑捕获。
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'] },
    },
    // W06：第二引擎进入稳定 lane（Desktop + Mobile viewport + 跨内核）。
    // Firefox 与 @ui lane（playwright.ui.config.ts）复用同一安装，
    // 不新增 CI 浏览器安装；捕获 Chromium 之外的引擎差异。
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    command: `pnpm --filter @educanvas/web exec next start --port ${port}`,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      EDUCANVAS_DEPLOYMENT_ENV: 'test',
      EDUCANVAS_ENABLE_DESIGN_QA: 'true',
      MODEL_GATEWAY_PROVIDER: '',
      MODEL_GATEWAY_API_KEY: '',
      /* E2E 的原始 Asset 与 Worker 派生物共用同一个隔离根；否则 Web 读取
         默认 uploads、Worker 读取 OBJECT_STORAGE_ROOT，会让真实预览链断开。 */
      ASSET_STORAGE_ROOT: objectStorageRoot,
      OBJECT_STORAGE_ROOT: objectStorageRoot,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
});
