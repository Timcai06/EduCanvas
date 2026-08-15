import { expect, type Locator, type Page } from '@playwright/test';
import { openLearningWorkspace } from '../study-onboarding';

// ── General journey helpers (extracted from general-chat-flow.spec.ts) ──

export const ACTIVE_CONVERSATION_COOKIE =
  '__Host-educanvas_active_conversation';
export const STUDIO_TRIGGER_NAME = '打开全部资源';
export const PLUS_MENU_TRIGGER_NAME = '添加来源';

/* 用 DOM 属性定位而非 getByRole：抽屉收起时 aria-hidden+inert 会把 aside
   移出可访问性树，role 定位器计数为 0（实验已验证），状态探测全部落空。 */
export function notebookSidebar(page: Page) {
  return page.locator('aside[aria-label="笔记本侧栏"]');
}

/*
 * 窄屏（<lg）笔记本列表是覆盖抽屉：初始收起并带 inert/aria-hidden，
 * 桌面端挂载后自动展开。交互前必须展开（幂等），否则定位与点击全部落空。
 */
export async function openNotebookSidebar(page: Page) {
  const sidebar = notebookSidebar(page);
  if ((await sidebar.getAttribute('aria-hidden')) === 'true') {
    await page.getByRole('button', { name: '打开笔记本列表' }).click();
  }
  await expect(sidebar).toHaveAttribute('aria-hidden', 'false');
  return sidebar;
}

/* 收起抽屉：展开状态下遮罩会拦截主区指针事件（桌面端抽屉在流内无遮罩）。 */
export async function closeNotebookSidebar(page: Page) {
  const sidebar = notebookSidebar(page);
  if ((await sidebar.getAttribute('aria-hidden')) === 'false') {
    await page.getByRole('button', { name: '收起笔记本侧栏' }).click();
  }
  await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
}

export async function openStudioInput(page: Page) {
  await page.getByRole('button', { name: STUDIO_TRIGGER_NAME }).click();
  const studio = page.getByRole('region', {
    name: '当前笔记本的资源控制台',
  });
  await expect(studio).toBeVisible();
  await studio.getByRole('tab', { name: /^来源/ }).click();
  await expect(studio.getByRole('list', { name: '来源列表' })).toBeVisible();
  return studio;
}

export async function openStudioOutput(page: Page) {
  await page.getByRole('button', { name: STUDIO_TRIGGER_NAME }).click();
  const studio = page.getByRole('region', {
    name: '当前笔记本的资源控制台',
  });
  await expect(studio).toBeVisible();
  await studio.getByRole('tab', { name: /^输出/ }).click();
  await expect(studio.getByRole('list', { name: '输出列表' })).toBeVisible();
  return studio;
}

export async function closeStudio(page: Page) {
  await page.getByRole('button', { name: '返回对话页面' }).click();
  await expect(
    page.getByRole('region', { name: '当前笔记本的资源控制台' }),
  ).toHaveCount(0);
}

export async function activeConversationId(page: Page) {
  return (await page.context().cookies()).find(
    (cookie) => cookie.name === ACTIVE_CONVERSATION_COOKIE,
  )?.value;
}

export async function createNotebook(
  page: Page,
  trigger: Locator,
  previousConversationContent: Locator,
) {
  const previousConversationId = await activeConversationId(page);
  expect(previousConversationId).toBeDefined();

  await trigger.click();
  await expect
    .poll(() => activeConversationId(page), {
      message: '新建笔记本后应切换服务端权威的活动会话',
      timeout: 15_000,
    })
    .not.toBe(previousConversationId);

  await expect(previousConversationContent).toHaveCount(0, {
    timeout: 15_000,
  });

  const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue('');
  await expect(
    page.getByRole('region', { name: 'EduCanvas 技术栈' }),
  ).toBeVisible();
  /* 切换会话若未触发整页重载，窄屏抽屉仍会展开：幂等收起，
     避免遮罩拦截后续主区交互。 */
  await closeNotebookSidebar(page);
}

export async function waitForUnavailableTurn(page: Page) {
  await expect(page.getByText('AI 暂时无法回答，请稍后重试。')).toBeVisible({
    timeout: 30_000,
  });
}

// ── Learning journey helpers (extracted from learning-flow.spec.ts) ──

export const THREE_ANSWER_PROGRESS = /答对\s*\d+\/3/;

/*
 * Chat-first 布局下 Canvas 与进度均按需打开：Canvas 经「+」菜单显式打开，
 * 进度经顶栏徽章展开抽屉。安全与幂等断言（Cookie 隔离、判分键不泄漏、重复提交
 * 只计一次）与布局无关，保持不变。
 */

export function canvasRegion(page: Page) {
  /* CanvasHost 窄屏自动 compact：教学 Canvas 桌面为 region、窄屏为 dialog
     （canvas-host.tsx role={isModal ? 'dialog' : 'region'}）。两态兼容定位。 */
  return page
    .getByRole('region', { name: '教学Canvas' })
    .or(page.getByRole('dialog', { name: '教学Canvas' }));
}

export function aiUnavailableMessage(page: Page) {
  return page.getByText('AI 老师暂时无法连接，请稍后重试。', {
    exact: true,
  });
}

export async function mockUnavailableTurn(page: Page) {
  await page.route('**/api/v1/learn/turn', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'model_unavailable',
          message: 'AI 老师暂时无法连接，请稍后重试。',
        },
      }),
    });
  });
}

export async function startLearning(page: Page) {
  await mockUnavailableTurn(page);
  await openLearningWorkspace(page);
  await expect(
    page.getByRole('heading', { name: '今天想学什么？' }),
  ).toBeVisible();
  const composer = page.getByPlaceholder('向 EduCanvas 提问');
  await composer.fill('请打开互动演示，让我动手试试。');
  /* 等 React 状态落定（发送按钮仅在 hasPayload 时渲染），避免 Enter 被旧闭包吞掉。
     2026-08-07 Actions incident 恢复期实测：慢 runner 上 hasPayload 渲染可 >5s
     （@ui Learning Rail 连续两次 5s 超时，同代码本地 17.8s 通过）。15s 为真实
     预算（正常环境 <1s），非无限 retry。 */
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled({
    timeout: 15_000,
  });
  await composer.press('Enter');
  await expect(aiUnavailableMessage(page)).toBeVisible();
  await expect(page.getByText('请打开互动演示，让我动手试试。')).toBeVisible();
}

/** 优先消费老师消息中的快捷入口，否则从“本课产物”打开预置 Canvas。 */
export async function openCanvasFromChat(page: Page) {
  const quickOpen = page.getByRole('button', { name: '打开互动演示' });
  if ((await quickOpen.count()) > 0) {
    const opener = quickOpen.first();
    await opener.click();
    await expect(page.locator('[aria-label="教学Canvas"]')).toBeVisible();
    return opener;
  } else {
    const studioTrigger = page.getByRole('button', { name: '本课产物' });
    await expect(studioTrigger).toBeVisible();
    await studioTrigger.click();
    const studio = page.getByRole('dialog', { name: '本课产物' });
    await expect(studio).toBeVisible();
    const studioArtifact = studio
      .getByRole('button', { name: /互动分类|本课预置/ })
      .first();
    await expect(studioArtifact).toBeVisible();
    await studioArtifact.click();
    await expect(page.locator('[aria-label="教学Canvas"]')).toBeVisible();
    return studioTrigger;
  }
}

/** 打开进度抽屉并返回其中的可信进度区域。 */
export async function openProgress(page: Page) {
  await page.getByRole('button', { name: /学习进度/ }).click();
  const progress = page.getByRole('region', { name: '学习进度' });
  await expect(progress).toBeVisible();
  return progress;
}

/** S0 intentionally hides Progress; mocked turns are not persisted across reloads. */
export async function ensureConversationUi(page: Page) {
  const progressTrigger = page.getByRole('button', { name: /学习进度/ });
  if (await progressTrigger.isVisible()) return;
  const composer = page.getByPlaceholder('向 EduCanvas 提问');
  await expect(composer).toBeVisible();
  await composer.fill('继续学习并查看进度。');
  /* 等 React 状态落定（发送按钮仅在 hasPayload 时渲染），避免 Enter 被旧闭包吞掉。
     2026-08-07 Actions incident 恢复期实测：慢 runner 上 hasPayload 渲染可 >5s
     （@ui Learning Rail 连续两次 5s 超时，同代码本地 17.8s 通过）。15s 为真实
     预算（正常环境 <1s），非无限 retry。 */
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled({
    timeout: 15_000,
  });
  await composer.press('Enter');
  await expect(aiUnavailableMessage(page)).toBeVisible();
}

export async function closeSheet(page: Page) {
  await page.keyboard.press('Escape');
}

export async function completeVisibleArtifact(canvas: Locator) {
  const submit = canvas.getByRole('button', { name: /提交/ });
  const choices = canvas.getByRole('radio');
  const choiceCount = await choices.count();

  expect(choiceCount, 'Canvas 至少应提供一个可访问的单选项').toBeGreaterThan(0);
  const completedGroups = new Set<string>();
  for (let index = 0; index < choiceCount; index += 1) {
    const choice = choices.nth(index);
    const groupName = await choice.getAttribute('name');
    if (!groupName || completedGroups.has(groupName)) continue;
    await choice.check();
    completedGroups.add(groupName);
  }

  await expect(submit).toBeEnabled();
  return submit;
}
