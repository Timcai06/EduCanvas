import type { Page } from "@playwright/test";

const turnId = "learning-recommendation-fixture-turn";
const assistantMessageId = "learning-recommendation-fixture-assistant";
const toolCallId = "learning-recommendation-fixture-tool";

const frames = [
  {
    type: "turn.accepted",
    studentMessageId: "learning-recommendation-fixture-student",
    assistantMessageId,
    replayed: false,
  },
  {
    type: "tool.started",
    toolCallId,
    label: "正在使用工具",
    activity: "other",
  },
  { type: "tool.completed", toolCallId },
  {
    type: "message.delta",
    messageId: assistantMessageId,
    delta:
      "下一步建议：复习“输入特征”。\n\n依据：本轮练习显示这个知识点还未掌握；巩固后再学习“目标标签”。",
  },
  { type: "turn.completed", messageId: assistantMessageId },
] as const;

/**
 * Feeds a valid, already-projected teaching-turn SSE stream through the browser
 * fetch boundary. This verifies the client protocol and visible rendering only;
 * it does not execute ToolKernel or claim a Provider/tool-backend result.
 */
export async function installLearningRecommendationSseFixture(page: Page) {
  const requestBodies: unknown[] = [];
  const body = frames
    .map((payload) => {
      const data = {
        ...payload,
        schemaVersion: "1",
        turnId,
      };
      return `event: ${payload.type}\ndata: ${JSON.stringify(data)}\n\n`;
    })
    .join("");

  await page.route("**/api/v1/learn/turn**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      requestUrl.pathname !== "/api/v1/learn/turn" ||
      route.request().method() !== "POST"
    ) {
      await route.continue();
      return;
    }
    requestBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
      body: Buffer.from(body, "utf8"),
    });
  });

  return { requestBodies };
}
