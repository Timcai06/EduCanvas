import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'web-runtime-stress.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20_000,
  outputDir: 'output/playwright/runtime-pressure',
  reporter: [['line']],
  projects: [
    {
      name: 'chromium-runtime-pressure',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--host-resolver-rules=MAP harness.test 127.0.0.1, MAP runtime.test 127.0.0.1',
            '--site-per-process',
          ],
        },
      },
    },
  ],
});
