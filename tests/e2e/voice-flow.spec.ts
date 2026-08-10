import { expect, test } from '@playwright/test';

test('@smoke V17 短句只提交一次既有 Turn，课堂字幕零提交', async ({ page }) => {
  await page.goto('/design-qa/voice');

  await page.getByRole('button', { name: '开始语音输入' }).click();
  await expect(page.locator('[data-voice-partial]')).toHaveText('正在识别');
  await page.getByRole('button', { name: '结束语音输入' }).click();
  await expect(page.locator('[data-voice-turn-count]')).toHaveText('1');
  await expect(page.locator('[data-voice-last-turn]')).toHaveText(
    '第一句完成 第二句完成',
  );

  await page.getByRole('button', { name: '课堂字幕' }).click();
  await page.getByRole('button', { name: '开始语音输入' }).click();
  await page.getByRole('button', { name: '结束语音输入' }).click();
  await expect(page.getByRole('list', { name: '课堂字幕' })).toContainText(
    '第一句完成',
  );
  await expect(page.getByRole('list', { name: '课堂字幕' })).toContainText(
    '第二句完成',
  );
  await expect(page.locator('[data-voice-turn-count]')).toHaveText('1');
});
