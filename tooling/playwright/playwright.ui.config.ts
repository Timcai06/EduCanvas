import { defineConfig } from '@playwright/test';
import { devices } from '@playwright/test';
import base from './playwright.config';

/**
 * @ui lane（Q05）：视觉/响应式/焦点/动画回归，与基础配置同目录维护。
 *
 * 与默认 lane 分离：默认 lane 通过 grepInvert 排除 @ui，避免视觉抖动
 * 阻塞所有后端 PR；本 config 只跑 @ui 用例，覆盖 Chromium + Firefox
 * 两个桌面浏览器，由 ui.yml 以 nightly + 前端路径触发 + 手动 dispatch
 * 方式执行（GitHub 上匹配路径的 PR 才会出现本 check）。
 */
export default defineConfig({
  ...base,
  // 只跑 @ui 用例；清除默认 config 的 grepInvert（两者叠加会成空集）。
  grep: /@ui/,
  grepInvert: undefined,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});
