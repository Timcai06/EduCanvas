import { expect, test } from "@playwright/test";
import {
  closeNotebookSidebar,
  notebookSidebar,
  openNotebookSidebar,
  waitForUnavailableTurn,
} from "./helpers/journey-helpers";

test("笔记本侧栏关闭幂等且重载遵循桌面持久化与窄屏默认收起", async ({
  page,
}) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "向 EduCanvas 提问" });
  await composer.fill("验证笔记本列表的关闭状态");
  await page.getByRole("button", { name: "发送" }).click();
  await waitForUnavailableTurn(page);
  const sidebar = await openNotebookSidebar(page);
  const close = sidebar.locator("button").filter({ hasText: "收起列表" });
  await close.click();
  // 隐藏后的重复事件模拟同一关闭意图的重入，不能反向打开抽屉。
  await close.dispatchEvent("click");
  await closeNotebookSidebar(page);
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  expect(
    await page.evaluate(() => localStorage.getItem("educanvas.sidebar")),
  ).toBe("0");

  // Notebook routes may stream their loading fallback before completing the
  // document response. The initialized marker below is the app-ready boundary.
  await page.reload({ waitUntil: "commit" });
  await expect(page.locator('[data-sidebar-initialized="true"]')).toHaveCount(
    1,
  );
  await expect(notebookSidebar(page)).toHaveAttribute("aria-hidden", "true");
  await expect(notebookSidebar(page)).toHaveAttribute("inert", "");
  await expect(
    page.getByRole("button", { name: "打开笔记本列表" }),
  ).toBeVisible();

  await openNotebookSidebar(page);
  expect(
    await page.evaluate(() => localStorage.getItem("educanvas.sidebar")),
  ).toBe("1");
  await page.reload({ waitUntil: "commit" });
  await expect(page.locator('[data-sidebar-initialized="true"]')).toHaveCount(
    1,
  );
  const desktop = (page.viewportSize()?.width ?? 0) >= 1024;
  await expect(notebookSidebar(page)).toHaveAttribute(
    "aria-hidden",
    desktop ? "false" : "true",
  );

  await openNotebookSidebar(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(notebookSidebar(page)).toHaveAttribute("aria-hidden", "true");
  expect(
    await page.evaluate(() => localStorage.getItem("educanvas.sidebar")),
  ).toBe("0");
});

test("侧栏关闭后归还入口焦点，但延迟回调不抢占新的输入焦点", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "向 EduCanvas 提问" });
  await composer.fill("验证侧栏焦点恢复");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await waitForUnavailableTurn(page);
  const sidebar = await openNotebookSidebar(page);
  await sidebar.getByRole("button", { name: "收起列表" }).click();
  const opener = page.getByRole("button", { name: "打开笔记本列表" });
  await expect(opener).toBeFocused();
  await openNotebookSidebar(page);
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await openNotebookSidebar(page);

  // 控制下一帧的顺序，覆盖关闭与新输入交错；不靠随机延迟碰运气。
  await page.evaluate(() => {
    const original = window.requestAnimationFrame;
    const callbacks: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    };
    Object.assign(window, {
      flushSidebarFrames: () => {
        window.requestAnimationFrame = original;
        for (const callback of callbacks.splice(0)) callback(performance.now());
      },
    });
  });
  const close = sidebar.locator("button").filter({ hasText: "收起列表" });
  await close.focus();
  await close.dispatchEvent("click");
  await close.dispatchEvent("click");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await composer.focus();
  await expect(composer).toBeFocused();
  await page.evaluate(() => {
    const frames = window as unknown as { flushSidebarFrames: () => void };
    frames.flushSidebarFrames();
  });
  await expect(composer).toBeFocused();
  await composer.fill("校园雨水花园笔记本");
  await expect(composer).toHaveValue("校园雨水花园笔记本");
});
