import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
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

const webPort = Number(process.env.PLAYWRIGHT_PORT ?? '3100');
const runtimePort = Number(process.env.WEB_RUNTIME_PORT ?? '3300');
const webBaseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${webPort}`;
const runtimeOrigin =
  process.env.WEB_RUNTIME_PUBLIC_ORIGIN ?? `http://runtime.test:${runtimePort}`;
const runtimeHealthUrl = `http://127.0.0.1:${runtimePort}/health`;
const objectStorageRoot = path.join(
  repoRoot,
  'output/playwright/object-storage',
);

export default defineConfig({
  testDir: path.join(repoRoot, 'tests/e2e'),
  testMatch: 'web-runtime-composition.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  outputDir: path.join(repoRoot, 'output/playwright/runtime-composition'),
  reporter: [
    ['line'],
    [
      'html',
      {
        open: 'never',
        outputFolder: path.join(
          repoRoot,
          'output/playwright/runtime-composition-report',
        ),
      },
    ],
  ],
  use: {
    baseURL: webBaseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-runtime-composition',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            `--host-resolver-rules=MAP runtime.test 127.0.0.1`,
            '--site-per-process',
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: `pnpm --filter @educanvas/web exec next start --port ${webPort}`,
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        EDUCANVAS_DEPLOYMENT_ENV: 'test',
        EDUCANVAS_ENABLE_DESIGN_QA: 'true',
        // Runtime composition does not exercise the first-run product choice.
        // Match the primary E2E config so the experience gate cannot mask Runtime assertions.
        EDUCANVAS_EXPERIENCE_MODE_DEFAULT: 'restricted',
        MODEL_GATEWAY_PROVIDER: '',
        MODEL_GATEWAY_API_KEY: '',
        EDUCANVAS_WEB_RUNTIME_PUBLIC_ORIGIN: runtimeOrigin,
        EDUCANVAS_WEB_RUNTIME_PORT: String(runtimePort),
        EDUCANVAS_WEB_PUBLIC_ORIGIN: webBaseURL,
        ASSET_STORAGE_ROOT: objectStorageRoot,
        OBJECT_STORAGE_ROOT: objectStorageRoot,
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: webBaseURL,
    },
    {
      command: `pnpm --filter @educanvas/web-runtime dev`,
      cwd: repoRoot,
      env: {
        ...process.env,
        EDUCANVAS_WEB_RUNTIME_HOST: '127.0.0.1',
        EDUCANVAS_WEB_RUNTIME_PORT: String(runtimePort),
        EDUCANVAS_WEB_RUNTIME_PUBLIC_ORIGIN: runtimeOrigin,
        EDUCANVAS_WEB_PUBLIC_ORIGIN: webBaseURL,
        DATABASE_URL: databaseUrl,
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: runtimeHealthUrl,
    },
  ],
});
