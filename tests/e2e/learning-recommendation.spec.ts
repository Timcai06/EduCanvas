import { expect, test } from "@playwright/test";
import { openLearningWorkspace } from "./study-onboarding";
import { installLearningRecommendationSseFixture } from "./fixtures/learning-recommendation-sse";

test("G03-9 学习对话呈现下一步建议与依据", async ({ page }) => {
  /* The fixture supplies projected protocol events at the browser boundary.
     recommendNextNode's trusted decision logic is covered by teaching-core unit
     tests; this browser test checks only SSE consumption and visible rendering. */
  const fixture = await installLearningRecommendationSseFixture(page);
  await openLearningWorkspace(page);

  const composer = page.getByRole("textbox", { name: "向 EduCanvas 提问" });
  await composer.fill("这次练习后，我下一步应该学什么？");
  await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
  await composer.press("Enter");

  const conversation = page.getByRole("region", { name: "AI教师对话" });
  await expect(
    conversation.getByText("下一步建议：复习“输入特征”。", { exact: false }),
  ).toBeVisible();
  await expect(
    conversation.getByText(
      "依据：本轮练习显示这个知识点还未掌握；巩固后再学习“目标标签”。",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    conversation.getByRole("list", { name: "这轮回答使用的工具" }),
  ).toContainText("正在使用工具");
  await expect(page.locator('p[aria-live="polite"]')).toHaveText(
    "AI 老师回答完成",
  );

  expect(fixture.requestBodies).toHaveLength(1);
  expect(fixture.requestBodies[0]).toMatchObject({
    text: "这次练习后，我下一步应该学什么？",
  });
});
