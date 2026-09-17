import { expect, test, type Page } from '@playwright/test';
import { openLearningWorkspace } from './study-onboarding';
import {
  canvasRegion,
  closeSheet,
  completeVisibleArtifact,
  openCanvasFromChat,
  openProgress,
  CURRENT_ARTIFACT_PROGRESS,
} from './helpers/journey-helpers';

/**
 * 竞赛演示路径走查。
 *
 * 按[核心闭环冻结](docs/01-product/05-核心闭环冻结.md)冻结的三个任务逐步走完，
 * 每步截图到 `output/demo-walkthrough/`，用于：
 *
 * 1. 录像前确认演示路径今天仍然走得通——不是靠记忆，而是靠一次真跑；
 * 2. 给报告与演示稿提供一致的界面素材；
 * 3. 任何改动后重跑，立刻知道演示会不会翻车。
 *
 * 断言只保留「这一步确实发生了」的底线（服务端判分结果、掌握度持久化），
 * 视觉效果由人看图判断，不把主观审美写成断言。
 *
 * **模型回答是 fixture，不是真实模型输出。** 走查不依赖外部 Provider，因此老师的
 * 讲解由一段固定 SSE 提供；渲染、引用、Canvas、判分与掌握度全部是真实产品路径。
 * 这些截图可以用来确认路径与界面，**不能当作真实模型质量的证据**；录像与答辩
 * 必须配置真实 Provider 重跑。
 *
 * （journey-helpers 的 `startLearning` 刻意 mock 成模型不可用，用于验证诚实失败
 * 路径。那条路径的截图会显示「AI 老师暂时无法连接」，不适合做演示素材，故此处
 * 自带一段成功回答的 fixture。）
 *
 * 不进默认 CI lane（见 playwright.config.ts 的 testIgnore），按需运行：
 *
 *   pnpm demo:walkthrough
 */

const SHOT = 'output/demo-walkthrough';

const DEMO_ANSWER =
  '我们先看能直接观察到的特征：耳朵形状、毛色和脸型。把这些特征和最终的类别标签分开，是理解图像识别的第一步。';

/**
 * 用一段固定 SSE 冒充老师的讲解，让走查不依赖外部 Provider。
 * 渲染、Canvas、判分与掌握度仍走真实产品路径——被替换的只有模型本身。
 */
async function stubTeacherAnswer(page: Page): Promise<void> {
  await page.route('**/api/v1/learn/turn', async (route) => {
    const turnId = 'demo-turn';
    const messageId = 'demo-assistant';
    const frame = (type: string, data: Record<string, unknown>) =>
      `event: ${type}\ndata: ${JSON.stringify({ type, schemaVersion: '1', ...data })}\n\n`;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: [
        frame('turn.accepted', {
          turnId,
          studentMessageId: 'demo-student',
          assistantMessageId: messageId,
          replayed: false,
        }),
        frame('message.delta', { turnId, messageId, delta: DEMO_ANSWER }),
        frame('turn.completed', { turnId, messageId }),
      ].join(''),
    });
  });
}

test('演示路径：问懂一个知识点 → 动手试一次 → 知道自己会了没有', async ({
  page,
}) => {
  /* 演示路径比单条断言长，且包含真实 Server Action；沿用 learning-journey
     对慢 runner 的预算，不用固定 sleep 代替事件等待。 */
  test.setTimeout(120_000);

  await stubTeacherAnswer(page);

  // ── 步骤 1：进入学习工作台（含学段选择／短诊断） ──
  await openLearningWorkspace(page);
  await page.screenshot({ path: `${SHOT}/01-进入学习工作台.png` });

  // ── 步骤 2：提问，得到按学段调整的回答（回答为 fixture） ──
  await expect(
    page.getByRole('heading', { name: '今天想学什么？' }),
  ).toBeVisible();
  const composer = page.getByPlaceholder('向 EduCanvas 提问');
  await composer.fill('请打开互动演示，让我动手试试。');
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled({
    timeout: 15_000,
  });
  await composer.press('Enter');
  await expect(page.getByText('请打开互动演示，让我动手试试。')).toBeVisible();
  await expect(page.getByText(DEMO_ANSWER)).toBeVisible();
  await page.screenshot({ path: `${SHOT}/02-提问与回答.png` });

  // ── 步骤 3：打开 Canvas，进入互动产物 ──
  await openCanvasFromChat(page);
  const canvas = canvasRegion(page);
  await expect(canvas).toBeVisible();
  await page.screenshot({ path: `${SHOT}/03-Canvas互动产物.png` });

  // ── 步骤 4：动手完成练习 ──
  const submit = await completeVisibleArtifact(canvas);
  await page.screenshot({ path: `${SHOT}/04-完成练习待提交.png` });

  // ── 步骤 5：服务端判分 ──
  /* 演示的核心卖点：判分由服务端确定性代码给出，答案不下发到客户端。
     这条断言同时是演示前的安全自检——若答案泄漏，演示时打开 DevTools 就露馅。 */
  expect(await page.content()).not.toMatch(
    /correctCategoryId|correctOptionId|gradingKey/,
  );
  await submit.click();
  await expect(canvas.getByRole('status').first()).toContainText('本次答对');
  await page.screenshot({ path: `${SHOT}/05-服务端判分结果.png` });

  // ── 步骤 6：掌握度更新并可回看 ──
  await page.keyboard.press('Escape');
  await expect(canvasRegion(page)).toHaveCount(0);
  const progress = await openProgress(page);
  await expect(progress).toContainText(CURRENT_ARTIFACT_PROGRESS);
  await page.screenshot({ path: `${SHOT}/06-掌握度.png` });
  await closeSheet(page);

  // ── 步骤 7：刷新后仍在——演示时最容易被追问的一点 ──
  await page.reload();
  /* 掌握度由服务端判分写入，刷新后确实持久——这正是本步要展示的。
     但对话消息不会持久：turn 是浏览器层 stub，服务端没有记录，刷新后回到
     landing 态而进度入口只在非 landing 时渲染。因此再发一条消息退出 landing，
     再读服务端的掌握度。真实 Provider 下消息本身也会持久，不需要这一步。 */
  const composerAfterReload = page.getByPlaceholder('向 EduCanvas 提问');
  await expect(composerAfterReload).toBeVisible();
  await composerAfterReload.fill('继续学习并查看进度。');
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled({
    timeout: 15_000,
  });
  await composerAfterReload.press('Enter');
  await expect(page.getByRole('button', { name: /学习进度/ })).toBeVisible({
    timeout: 15_000,
  });
  const progressAfterReload = await openProgress(page);
  await expect(progressAfterReload).toContainText(CURRENT_ARTIFACT_PROGRESS);
  await page.screenshot({ path: `${SHOT}/07-刷新后掌握度仍在.png` });
});
