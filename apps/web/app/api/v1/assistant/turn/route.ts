import { randomUUID } from 'node:crypto';
import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import {
  loadOwnedGeneralConversation,
  writeActiveConversationCookie,
} from '@/server/platform/general-conversation';
import { resolveTurnModelRuntime } from '@/server/model/model-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 单条指令最大长度 */
const MAX_TEXT_BYTES = 2_048;

/** 面板名称到用户可见文案的映射 */
const PANEL_LABELS: Record<string, string> = {
  upload_file: '上传文件',
  upload_image: '上传图片',
  add_link: '导入网页',
  create_mind_map: '生成思维导图',
  create_slides: '生成 Slides',
  create_flashcards: '生成闪卡',
  create_audio_overview: '生成音频概览',
  create_note: '创建笔记',
};

/** 助手的能力清单，用于 unknown 回退时展示 */
const CAPABILITY_MESSAGE =
  '我可以帮你：\n- 管理笔记本（新建、列出、重命名、删除、切换）\n- 上传文件和图片\n- 导入网页链接\n- 生成和打开思维导图、Slides、闪卡、音频概览、笔记\n- 查看当前有哪些产物\n\n直接告诉我要做什么就行。其他问题可以在主对话里问 AI 老师。';

// ── 意图分类 ──────────────────────────────────────────────────────

interface AssistantIntent {
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
 * 让 DeepSeek 做一次极简分类，返回 JSON。
 * 只包含管理操作和产物创建。不在范围内的返回 unknown。
 */
async function classifyIntent(
  message: string,
  notebooks: { id: string; title: string }[],
): Promise<AssistantIntent> {
  const runtime = resolveTurnModelRuntime();
  if (!runtime?.gateway) throw new Error('model_unavailable');

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

  for await (const event of runtime.gateway.streamTurnText({
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
      chunks.push(event.delta);
    }
    if (event.type === 'failed') {
      throw new Error(event.error?.code ?? 'model_error');
    }
  }

  const raw = chunks.join('').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { action: 'unknown' };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const validActions = [
      'list_notebooks',
      'list_artifacts',
      'create_notebook',
      'rename_notebook',
      'delete_notebook',
      'switch_notebook',
      'open_artifact',
      'open_panel',
      'unknown',
    ];
    if (!parsed.action || !validActions.includes(parsed.action)) {
      return { action: 'unknown' };
    }
    return parsed as AssistantIntent;
  } catch {
    return { action: 'unknown' };
  }
}

// ── 路由处理 ──────────────────────────────────────────────────────

/**
 * POST /api/v1/assistant/turn
 *
 * 小助手端点：意图识别 + 直接调已有 API。
 * 仅处理管理操作和产物创建，超出范围礼貌拒绝。
 */
export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }

  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');

  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) {
    return jsonError(404, 'conversation_not_found', '请先在主界面开始对话。');
  }

  let body: { text?: string; clientMessageId?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'invalid_json', '消息格式不正确。');
  }

  const text = (body.text ?? '').trim();
  if (!text || Buffer.byteLength(text, 'utf-8') > MAX_TEXT_BYTES) {
    return jsonError(400, 'invalid_message', '请输入有效指令。');
  }

  const repo = new DrizzlePlatformConversationRepository();
  const notebooks = await repo.listOwnedRecent({
    trustedSubjectId: identity.studentId,
    limit: 50,
  });

  let intent: AssistantIntent;
  try {
    intent = await classifyIntent(
      text,
      notebooks.map((n) => ({
        id: n.id,
        title: n.title ?? '未命名笔记本',
      })),
    );
  } catch {
    return jsonError(503, 'assistant_unavailable', '助手暂时不可用。');
  }

  try {
    switch (intent.action) {
      case 'list_notebooks': {
        const list = notebooks
          .map((n) => `- ${n.title || '未命名笔记本'}`)
          .join('\n');
        return jsonResponse({
          message:
            notebooks.length > 0
              ? `当前有 ${notebooks.length} 个笔记本：\n${list}`
              : '还没有笔记本。在主界面开始对话即可创建。',
        });
      }

      case 'list_artifacts': {
        const artUrl = new URL(
          '/api/v1/chat/artifacts',
          request.url,
        ).toString();
        const artRes = await fetch(artUrl, {
          headers: { cookie: request.headers.get('cookie') ?? '' },
        });
        if (!artRes.ok) {
          return jsonResponse({ message: '暂时无法获取产物列表。' });
        }
        const data = (await artRes.json()) as {
          artifacts?: { kind: string; title: string }[];
        };
        const items = data.artifacts ?? [];
        if (items.length === 0) {
          return jsonResponse({ message: '当前还没有 AI 产物，先生成一个吧' });
        }
        const labelMap: Record<string, string> = {
          mind_map: '思维导图',
          slides: 'Slides',
          flashcards: '闪卡',
          note: '笔记',
          audio_overview: '音频概览',
        };
        const list = items
          .map((a) => `- ${labelMap[a.kind] ?? a.kind}：${a.title}`)
          .join('\n');
        return jsonResponse({
          message: `当前有 ${items.length} 个产物：\n${list}`,
        });
      }

      case 'create_notebook': {
        const notebookTitle = intent.title ?? '未命名笔记本';
        const created = await repo.create({
          ownerSubjectId: identity.studentId,
          spaceKind: 'notebook',
          spaceTitle: notebookTitle,
          conversationTitle: notebookTitle,
          agentProfileId: 'general',
        });
        await writeActiveConversationCookie(created.id);
        return jsonResponse({
          message: `已创建笔记本「${notebookTitle}」。`,
          action: 'created',
        });
      }

      case 'rename_notebook': {
        if (!intent.notebookId || !intent.title) {
          return jsonResponse({ message: '请指定要重命名的笔记本和新名称。' });
        }
        await repo.renameOwned({
          conversationId: intent.notebookId,
          trustedSubjectId: identity.studentId,
          title: intent.title,
        });
        return jsonResponse({
          message: `已重命名为「${intent.title}」。`,
          action: 'renamed',
        });
      }

      case 'delete_notebook': {
        if (!intent.notebookId) {
          return jsonResponse({ message: '请指定要删除的笔记本。' });
        }
        const archived = await repo.archiveOwned({
          conversationId: intent.notebookId,
          trustedSubjectId: identity.studentId,
        });
        if (!archived) {
          return jsonResponse({ message: '笔记本不存在或无权删除。' });
        }
        return jsonResponse({
          message: '已删除。',
          action: 'deleted',
        });
      }

      case 'switch_notebook': {
        if (!intent.notebookId) {
          return jsonResponse({ message: '请指定要切换到的笔记本。' });
        }
        const target = notebooks.find((n) => n.id === intent.notebookId);
        if (!target) {
          return jsonResponse({ message: '找不到这个笔记本。' });
        }
        await writeActiveConversationCookie(target.id);
        return jsonResponse({
          message: `已切换到「${target.title ?? '未命名'}」。`,
          action: 'switched',
        });
      }

      case 'open_artifact': {
        // 获取当前笔记本的产物列表，按标题匹配
        const artifactsUrl = new URL(
          '/api/v1/chat/artifacts',
          request.url,
        ).toString();
        const artListRes = await fetch(artifactsUrl, {
          headers: { cookie: request.headers.get('cookie') ?? '' },
        });
        if (!artListRes.ok) {
          return jsonResponse({ message: '暂时无法获取产物列表。' });
        }
        const artList = (await artListRes.json()) as {
          artifacts?: { id: string; kind: string; title: string }[];
        };
        const artifacts = artList.artifacts ?? [];
        if (artifacts.length === 0) {
          return jsonResponse({ message: '当前还没有产物，先生成一个吧。' });
        }
        // 按标题关键词 + 类型匹配
        const keyword = (intent.title ?? '').toLowerCase();
        const kindFilter = intent.kind;
        let match = artifacts.find((a) => kindFilter && a.kind === kindFilter);
        if (!match && keyword) {
          match = artifacts.find((a) =>
            a.title.toLowerCase().includes(keyword),
          );
        }
        if (!match) {
          const names = artifacts.map((a) => `- ${a.title}`).join('\n');
          return jsonResponse({
            message: `没找到匹配的产物。当前有：\n${names}`,
          });
        }
        return jsonResponse({
          message: `正在打开「${match.title}」...`,
          action: 'open_artifact',
          artifactId: match.id,
        });
      }

      case 'open_panel': {
        const panel = intent.panel ?? 'unknown';
        const label = PANEL_LABELS[panel] ?? panel;
        return jsonResponse({
          message: `正在打开「${label}」...`,
          action: 'open_panel',
          panel,
        });
      }

      case 'unknown':
      default:
        return jsonResponse({ message: CAPABILITY_MESSAGE });
    }
  } catch {
    return jsonError(500, 'assistant_error', '操作失败，请重试。');
  }
}
