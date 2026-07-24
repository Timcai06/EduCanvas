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
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  outputDir: 'output/playwright/test-results',
  /*
   * 视觉快照容许极小的跨环境抗锯齿差异。本地基线用容器/darwin 生成，CI 跑在
   * GitHub x64 runner——中文字形的次像素渲染会有几十像素级别的差别（实测
   * chat-unavailable 仅 18px 不同），并非布局或内容回归。给一个小额度让 CI
   * 稳定，同时仍能拦下真实改动（真实变化是上千像素级）。
   */
  expect: {
    toHaveScreenshot: { maxDiffPixels: 200 },
  },
  reporter: [
    ['line'],
    [
      'html',
      {
        open: 'never',
        outputFolder: 'output/playwright/report',
      },
    ],
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
      OBJECT_STORAGE_ROOT: objectStorageRoot,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
});
