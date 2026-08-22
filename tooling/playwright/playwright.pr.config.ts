import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * 普通 PR / main push 的小型浏览器门禁。
 *
 * 完整稳定矩阵仍由同目录 playwright.config.ts 定义，并在 nightly 或手动预发布运行；
 * 这里仅执行显式 @smoke 的关键用户闭环，避免任意 Web/Package 改动都展开为
 * Chromium desktop + mobile + Firefox 的全量矩阵。
 */
export default defineConfig({
  ...base,
  grep: /@smoke/,
  grepInvert: /@ui/,
  projects: [
    {
      name: 'chromium-pr-smoke',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
