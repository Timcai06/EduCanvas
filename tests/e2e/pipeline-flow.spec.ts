import { expect, test } from '@playwright/test';

type PerformanceEvidence = {
  longTasks: number;
  layoutShift: number;
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const evidence: PerformanceEvidence = { longTasks: 0, layoutShift: 0 };
    (
      window as Window & { __pipelinePerformance?: PerformanceEvidence }
    ).__pipelinePerformance = evidence;

    if ('PerformanceObserver' in window) {
      try {
        new PerformanceObserver((list) => {
          evidence.longTasks += list.getEntries().length;
        }).observe({ type: 'longtask', buffered: true });
      } catch {
        // Older engines may not expose longtask; the counter remains explicit 0.
      }
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & {
              value: number;
              hadRecentInput: boolean;
            };
            if (!shift.hadRecentInput) evidence.layoutShift += shift.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {
        // LayoutShift is optional in the PerformanceObserver implementation.
      }
    }
  });
});

test('desktop playback, pause points and keyboard stay inside the template', async ({
  page,
}) => {
  await page.goto('/design-qa/pipeline-flow');

  const shell = page.getByTestId('animation-shell');
  const completionMessage =
    '动画播放完成不等于掌握；请回到对话解释每一步。';
  await expect(page.getByRole('heading', { name: '受控教学动画模板' })).toBeVisible();
  await expect(
    page.getByRole('region', {
      name: '跟随模型，把一张动物图片变成可信的分类结果',
    }),
  ).toBeVisible();
  await expect(page.getByTestId('pipeline-flow').getByRole('listitem')).toHaveCount(4);
  await expect(shell).toContainText('步骤 1/4');
  await expect(page.getByText(completionMessage)).toHaveCount(0);
  await expect(page.getByTestId('pipeline-completion')).toContainText(
    '播放到最后一步后',
  );

  await shell.focus();
  await page.keyboard.press('ArrowRight');
  await expect(shell).toContainText('步骤 2/4');
  await page.keyboard.press('Home');
  await expect(shell).toContainText('步骤 1/4');
  await page.keyboard.press('End');
  await expect(shell).toContainText('步骤 4/4');
  await expect(page.getByText(completionMessage)).toHaveCount(0);
  await page.keyboard.press('Home');
  await expect(shell).toContainText('步骤 1/4');

  await page.getByLabel('播放速度').selectOption('1.5');
  await page.evaluate(() => {
    const evidence = (
      window as Window & { __pipelinePerformance?: PerformanceEvidence }
    ).__pipelinePerformance;
    if (evidence) {
      evidence.longTasks = 0;
      evidence.layoutShift = 0;
    }
  });
  await page.getByRole('button', { name: '播放流程' }).click();
  await expect(shell).toContainText('步骤 2/4');
  await expect(page.getByTestId('animation-observation')).toContainText(
    'animation_paused',
  );

  const performance = await page.evaluate(() =>
    (
      window as Window & { __pipelinePerformance?: PerformanceEvidence }
    ).__pipelinePerformance,
  );
  expect(performance?.layoutShift).toBe(0);
  expect(performance?.longTasks).toBe(0);

  await page.getByRole('button', { name: '播放流程' }).click();
  await expect(shell).toContainText('步骤 3/4');
  await expect(page.getByTestId('animation-observation')).toContainText(
    'animation_paused',
  );
  await expect(page.getByText(completionMessage)).toHaveCount(0);
  await page.getByRole('button', { name: '播放流程' }).click();
  await expect(shell).toContainText('步骤 4/4');
  await expect(page.getByText(completionMessage)).toBeVisible();

  await page.getByRole('button', { name: '重置流程' }).click();
  await expect(shell).toContainText('步骤 1/4');
  await expect(page.getByText(completionMessage)).toHaveCount(0);
  await expect(page).toHaveScreenshot('pipeline-flow-desktop.png', {
    animations: 'disabled',
    fullPage: true,
    maxDiffPixelRatio: 0.01,
  });
});

test('mobile controls remain usable without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/design-qa/pipeline-flow');

  await expect(page.getByTestId('pipeline-flow').getByRole('listitem')).toHaveCount(4);
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.getByRole('button', { name: '播放流程' })).toBeVisible();
  await expect(page.getByLabel('播放速度')).toBeVisible();
  await expect(page).toHaveScreenshot('pipeline-flow-mobile.png', {
    animations: 'disabled',
    fullPage: true,
    maxDiffPixelRatio: 0.01,
  });
});

test('reduced motion advances synchronously and exposes the preference', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/design-qa/pipeline-flow');

  const shell = page.getByTestId('animation-shell');
  await expect(shell.getByText('减少动态')).toBeVisible();
  await expect(
    page.locator('[data-animation-step]').first(),
  ).toHaveCSS('will-change', 'auto');
  await expect(
    page.locator('[data-animation-connector]').first(),
  ).toHaveCSS('will-change', 'auto');
  await page.getByRole('button', { name: '播放流程' }).click();
  await expect(shell).toContainText('步骤 2/4');
  await expect(page.getByTestId('animation-observation')).toContainText(
    'animation_paused',
  );
  await expect(page.getByLabel('播放速度')).toBeDisabled();
  await expect(page).toHaveScreenshot('pipeline-flow-reduced-motion.png', {
    animations: 'disabled',
    fullPage: true,
    maxDiffPixelRatio: 0.01,
  });
});
