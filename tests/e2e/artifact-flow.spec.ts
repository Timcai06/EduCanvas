import { expect, test } from '@playwright/test';

/**
 * M1 验收场景:生成思维导图全链路
 * 对话 → 「+」菜单 → 确认卡 → 后台任务(真实 worker 进程消费)→ 产物卡 → Canvas 打开。
 * 不依赖模型 Provider:v1 大纲由 worker 规则生成,链路的每一环都是真实的。
 */
test('生成思维导图全链路经真实 worker 完成并可在 Canvas 打开', async ({
  page,
}) => {
  /* 与套件其余 spec 一致:reduced-motion 下交互确定性,动效由视觉基线覆盖 */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '你好，今天想探索什么？' }),
  ).toBeVisible();

  /* 入口页经 pending 菜单动作创建对话,工作台挂载后自动打开确认卡 */
  await page.getByRole('button', { name: '添加上下文或创建内容' }).click();
  await page.getByRole('menuitem', { name: /生成思维导图/ }).click();

  const confirmSheet = page.getByRole('dialog', { name: '生成思维导图' });
  await expect(confirmSheet).toBeVisible();
  await confirmSheet.getByRole('button', { name: '开始生成' }).click();

  /* 后台任务由独立 worker 进程消费;30s 内应完成 */
  await expect(page.getByText('思维导图已生成')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: '打开', exact: true }).click();

  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible();
  await expect(
    canvas.locator('[data-mind-map]').getByText('对话思维导图'),
  ).toBeVisible();

  /* 断连恢复读取面:刷新后产物仍在「产物」列表中 */
  await canvas.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '产物', exact: true }).click();
  const studio = page.getByRole('dialog', { name: '本次对话的产物' });
  await expect(studio.getByText('对话思维导图')).toBeVisible();
  await expect(studio.getByText('v1')).toBeVisible();
});

test('生成 Slides 全链路并可分页浏览', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: '添加上下文或创建内容' }).click();
  await page.getByRole('menuitem', { name: /生成 Slides/ }).click();

  const confirmSheet = page.getByRole('dialog', { name: '生成Slides' });
  await expect(confirmSheet).toBeVisible();
  await confirmSheet.getByRole('button', { name: '开始生成' }).click();

  await expect(page.getByText('Slides已生成')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: '打开', exact: true }).click();

  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible();
  /* 规则版空对话 = 仅封面页(按 heading 级别定位,避开宿主标题重名) */
  await expect(
    canvas.getByRole('heading', { level: 3, name: '对话小结 Slides' }),
  ).toBeVisible();
  await expect(canvas.getByText('1 / 1')).toBeVisible();
});
