import { randomUUID } from 'node:crypto';
import type {
  StreamAgentTextRequest,
  TurnModelEvent,
} from '@educanvas/agent-core';

/** 助手单条指令的意图分类结果。 */
export interface AssistantIntent {
  action:
    | 'list_notebooks'
    | 'list_artifacts'
    | 'create_notebook'
    | 'rename_notebook'
    | 'delete_notebook'
    | 'switch_notebook'
    | 'open_artifact'
    | 'open_panel'
    | 'unknown';
  notebookId?: string;
  title?: string;
  kind?: string;
  panel?: string;
  message?: string;
}

/**
 * classifyIntent 只依赖的最小 gateway 形状：与 `TurnModelGateway.streamTurnText`
 * 同构（resolveTurnModelRuntime().gateway 直接满足），测试可用 fake 注入。
 */
export interface ClassifyGateway {
  streamTurnText(
    request: StreamAgentTextRequest,
  ): AsyncIterable<TurnModelEvent>;
}

const VALID_ACTIONS = [
  'list_notebooks',
  'list_artifacts',
  'create_notebook',
  'rename_notebook',
  'delete_notebook',
  'switch_notebook',
  'open_artifact',
  'open_panel',
  'unknown',
] as const;

/**
 * 让模型做一次极简分类，返回 JSON。
 *
 * 只包含管理操作和产物创建；不在范围内的返回 `unknown`。LLM 输出是不可信输入：
 * 返回的 action 必须过白名单、JSON 提取失败一律回退 `unknown`；notebookId/title
 * 等字段的越权风险由 repo 层 `requireConversationAccess` 兜底（见 route.ts）。
 */
export async function classifyIntent(
  message: string,
  notebooks: { id: string; title: string }[],
  gateway: ClassifyGateway,
): Promise<AssistantIntent> {
  const notebookList = notebooks
    .map((n) => `- id: ${n.id}, 标题: ${n.title || '未命名'}`)
    .join('\n');

  const prompt = `你是一个分类器。根据用户指令，返回一个 JSON。

操作分为两类：

【直接执行类】小助手自己完成，不需要弹窗：
- list_notebooks：用户想看笔记本列表
- list_artifacts：用户想看当前有哪些 AI 产物（导图、Slides、闪卡、笔记等）
- create_notebook：用户要新建笔记本。从指令中提取名称作为 title
- rename_notebook：用户要重命名笔记本。需提供 notebookId 和新 title
- delete_notebook：用户要删除笔记本。需提供 notebookId
- switch_notebook：用户要切换到某个笔记本。从列表中匹配标题，提供 notebookId
- open_artifact：用户要打开已有的产物。常见说法与 kind 对应：导图/脑图→mind_map，Slides/PPT/小结→slides，闪卡/卡片/记忆卡→flashcards，笔记→note。同时提取标题关键词作为 title

【打开面板类】小助手打开对应面板，用户在面板里操作：
- upload_file：上传文件
- upload_image：上传图片
- add_link：导入网页链接
- create_mind_map：生成思维导图。从指令中提取主题作为 title
- create_slides：生成 Slides。从指令中提取主题作为 title
- create_flashcards：生成闪卡。从指令中提取主题作为 title
- create_audio_overview：生成音频概览
- create_note：创建笔记。从指令中提取主题作为 title

以上都走 action: "open_panel"，并提供 panel 字段（填对应值如 "create_mind_map"）和可选的 title。
unknown：用户的要求不在以上范围内。

当前用户的笔记本：
${notebookList || '（暂无）'}

用户指令：${message}

只返回 JSON，格式：{"action":"...","notebookId":"...","title":"...","panel":"...","message":"..."}
不需要的字段省略。`;

  const requestId = randomUUID();
  const chunks: string[] = [];

  for await (const event of gateway.streamTurnText({
    phase: 'answer',
    taskAlias: 'agent.turn',
    modelAlias: 'primary',
    promptVersion: 'assistant-classify-v1',
    messages: [{ role: 'user', content: prompt }],
    tools: [],
    toolResults: [],
    traceId: requestId,
    turnId: requestId,
  })) {
    if (event.type === 'text_delta') {
      chunks.push(event.delta ?? '');
    }
    if (event.type === 'failed') {
      throw new Error(event.error?.code ?? 'model_error');
    }
  }

  const raw = chunks.join('').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { action: 'unknown' };

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    if (
      typeof parsed.action !== 'string' ||
      !(VALID_ACTIONS as readonly string[]).includes(parsed.action)
    ) {
      return { action: 'unknown' };
    }
    return parsed as unknown as AssistantIntent;
  } catch {
    return { action: 'unknown' };
  }
}
