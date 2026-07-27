import 'server-only';

import type { AgentTool } from '@educanvas/agent-runtime';
import { z } from 'zod';

/**
 * 让模型用一句话说明接下来打算做什么。
 *
 * ## 为什么是工具而不是新的流式事件
 *
 * 目标是让界面显示「AI 正在想什么」。最直觉的做法是把供应商返回的 reasoning
 * 内容接出来，但那要在 model-gateway → agent-core → agent-runtime → gateway → web
 * 五个包里新挖一条数据通道，并且有两个真实问题：原始推理在 PRACTICE/ASSESS
 * 阶段必然包含答案（会泄题），而它绕过 `loop-runner` 只对 `text_delta` 生效的
 * 输出安全闸门（等于在安全审查旁边开后门）。
 *
 * 这个工具改为复用已经通了的工具调用通道：它没有任何副作用，唯一作用是产生一次
 * `tool.started` 事件，从而自动进入 SSE、自动被前端工具轨迹接住、自动受同一套
 * 闸门约束。零协议改动。
 *
 * ## 为什么内容不显示给学生
 *
 * 轨迹上显示的是服务端映射表里的固定文案「正在梳理思路」，不是这里的 `note`。
 * `note` 只回灌给模型自己（作为工具结果参与后续轮次），因此模型无法借它向学生
 * 输出未经输出闸门检查的文字。要改成显示模型原话，必须先让它过安全闸门。
 *
 * 风险等级 L0：无副作用、不需要审批、不产生可信学习事件。
 */

const planNoteInputSchema = z
  .object({
    /** 一句话即可；上限刻意压低，避免模型把它当成第二个回答通道。 */
    note: z.string().trim().min(1).max(200),
  })
  .strict();

const planNoteOutputSchema = z
  .object({ acknowledged: z.literal(true) })
  .strict();

export function createPlanNoteTool(): AgentTool<
  z.infer<typeof planNoteInputSchema>,
  z.infer<typeof planNoteOutputSchema>
> {
  return {
    name: 'planNote',
    description:
      '在开始一段较长的工作前，用一句话说明你接下来打算做什么（例如先查资料再举例）。它只用于让用户看到进度，不产生任何结果，也不能替代真正的回答。',
    inputSchema: planNoteInputSchema,
    outputSchema: planNoteOutputSchema,
    timeoutMs: 1_000,
    /* 有意不做任何事：这个工具的全部价值在于它被调用这件事本身。 */
    handler: async () => ({ acknowledged: true as const }),
  };
}
