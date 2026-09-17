import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * 渲染器走查：产出 `output/renderer-walkthrough/` 下的证据截图。
 *
 * 覆盖两类走查：
 *
 * - 渲染器走查（AR09）：逐个打开五个内容驱动渲染器并截图；
 * - 演示路径走查：按核心闭环冻结的三个任务走完整条演示路径并截图。
 *
 * 两者都只保留「这一步确实发生了」的底线断言，视觉好坏由人看图判断，不写成断言。
 * 人工走查不可复现也留不下证据，脚本化后任何改动都能立刻重跑。不进默认 CI lane：
 *
 *   pnpm test:walkthrough     # 两类都跑
 *   pnpm demo:walkthrough     # 只跑演示路径
 */
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: /(renderer|demo)-walkthrough\.spec\.ts/,
  grepInvert: undefined,
  projects: [
    {
      name: 'chromium-walkthrough',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
