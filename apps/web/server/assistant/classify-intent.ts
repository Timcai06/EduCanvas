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

/** 面板白名单：模型返回的 panel 必须在此闭集内，否则整条意图按 unknown 处理。 */
const VALID_PANELS = new Set([
  'upload_file',
  'upload_image',
  'add_link',
  'create_mind_map',
  'create_slides',
  'create_flashcards',
  'create_audio_overview',
  'create_note',
]);

/** 产物 kind 白名单（open_artifact 匹配用）。 */
const VALID_KINDS = new Set([
  'mind_map',
  'slides',
  'flashcards',
  'note',
  'audio_overview',
]);

/** 模型填写的意图文本字段长度上限（对齐产物 titleSchema 的 120）。 */
const MAX_INTENT_TEXT_LENGTH = 120;

/**
 * 构造分类请求。prompt 只携带标题与用户指令，不含消息正文之外的内容；
 * 每次调用独立 traceId/turnId（分类是一次无状态调用）。
 */
export function buildClassifyRequest(
  message: string,
  notebooks: { id: string; title: string }[],
): StreamAgentTextRequest {
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
- switch_notebook：用户要切换到某个笔记本。始终从指令中提取完整标题作为 title；若列表中能匹配，再提供 notebookId
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
  return {
    phase: 'answer',
    taskAlias: 'agent.turn',
    modelAlias: 'primary',
    promptVersion: 'assistant-classify-v1',
    messages: [{ role: 'user', content: prompt }],
    tools: [],
    toolResults: [],
    traceId: requestId,
    turnId: requestId,
  };
}

/** 流式收集模型文本；failed 事件向上抛错（由调用方转稳定错误）。 */
export async function collectModelText(
  request: StreamAgentTextRequest,
  gateway: ClassifyGateway,
): Promise<string> {
  const chunks: string[] = [];
  for await (const event of gateway.streamTurnText(request)) {
    if (event.type === 'text_delta') {
      chunks.push(event.delta ?? '');
    }
    if (event.type === 'failed') {
      throw new Error(event.error?.code ?? 'model_error');
    }
  }
  return chunks.join('').trim();
}

/**
 * 解析模型输出的 JSON 为意图。
 *
 * LLM 输出是不可信输入：action 必须过白名单、JSON 提取失败一律回退 `unknown`；
 * 其余字段做清洗——title 超长剔除、panel 必须在白名单（否则整条按 unknown）、
 * kind 必须在白名单（否则忽略）。notebookId 的越权风险由 repo 层
 * 所有权检查兜底（见 route.ts）。
 */
export function parseIntent(raw: string): AssistantIntent {
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
    const intent = parsed as unknown as AssistantIntent;
    if (
      typeof intent.title === 'string' &&
      intent.title.length > MAX_INTENT_TEXT_LENGTH
    ) {
      delete intent.title;
    }
    if (intent.panel !== undefined && !VALID_PANELS.has(intent.panel)) {
      return { action: 'unknown' };
    }
    if (intent.kind !== undefined && !VALID_KINDS.has(intent.kind)) {
      delete intent.kind;
    }
    return intent;
  } catch {
    return { action: 'unknown' };
  }
}

/**
 * 让模型做一次极简分类，返回 JSON。
 *
 * 只包含管理操作和产物创建；不在范围内的返回 `unknown`。字段清洗见
 * `parseIntent`；成本与账本边界由调用方（runClassifiedTurn）负责。
 */
export async function classifyIntent(
  message: string,
  notebooks: { id: string; title: string }[],
  gateway: ClassifyGateway,
): Promise<AssistantIntent> {
  return parseIntent(
    await collectModelText(buildClassifyRequest(message, notebooks), gateway),
  );
}
