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

  await page.reload();
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
  await page.reload();
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
