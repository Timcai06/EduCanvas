import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * 渲染器走查：产出 `output/renderer-walkthrough/` 下的证据截图。
 *
 * 对应 AR09 的「五渲染器手动走查」。人工走查不可复现也留不下证据，这里用同一套
 * DB fixture 逐个打开渲染器截图；断言只保留「确实渲染出内容」的底线，视觉好坏
 * 由人看图判断，不写成断言。不进默认 CI lane，按需运行：
 *
 *   pnpm test:walkthrough
 */
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: 'renderer-walkthrough.spec.ts',
  grepInvert: undefined,
  projects: [
    {
      name: 'chromium-walkthrough',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
