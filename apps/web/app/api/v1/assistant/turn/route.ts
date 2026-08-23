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
  clearActiveConversationCookie,
} from '@/server/platform/general-conversation';
import { checkAssistantRateLimit } from '@/server/assistant/rate-limit';
import {
  AssistantClassifyError,
  createAssistantClassifyDependencies,
  runClassifiedTurn,
} from '@/server/assistant/assistant-classify';
import type { classifyIntent } from '@/server/assistant/classify-intent';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 单条指令最大长度 */
const MAX_TEXT_BYTES = 2_048;

/**
 * create_notebook 的内存级幂等去重（同主体 + 同 clientMessageId，TTL 5 分钟）。
 * 只防同进程内的网络重试 / 多标签重复提交；跨实例与重启不保证——assistant
 * 端点是单实例部署形态，DB 级幂等（pg_advisory_xact_lock + 唯一约束）留待
 * 桌宠迭代需要时再迁移（见 manual-artifact-repository 的先例）。
 */
const NOTEBOOK_CREATE_DEDUP_TTL_MS = 5 * 60_000;
const notebookCreateDedup = new Map<string, { createdAt: number }>();
const NOTEBOOK_LOOKUP_PAGE_LIMIT = 100;
const NOTEBOOK_LOOKUP_MAX_PAGES = 10;

/** 惰性清理过期幂等记录，避免 Map 无限增长。 */
function pruneNotebookCreateDedup(now: number): void {
  for (const [key, record] of notebookCreateDedup) {
    if (now - record.createdAt > NOTEBOOK_CREATE_DEDUP_TTL_MS) {
      notebookCreateDedup.delete(key);
    }
  }
}

/** 在不扩张分类 prompt 的前提下，分页解析最近列表之外的精确标题。 */
async function findAccessibleNotebookByTitle(
  repo: DrizzlePlatformConversationRepository,
  trustedSubjectId: string,
  title: string,
) {
  const normalizedTitle = title.normalize('NFKC').trim().toLocaleLowerCase();
  let cursor: { timestamp: Date; id: string } | null = null;
  for (
    let pageIndex = 0;
    pageIndex < NOTEBOOK_LOOKUP_MAX_PAGES;
    pageIndex += 1
  ) {
    const page = await repo.listAccessibleRecentPage({
      trustedSubjectId,
      limit: NOTEBOOK_LOOKUP_PAGE_LIMIT,
      cursor,
    });
    const match = page.items.find(
      (notebook) =>
        notebook.title?.normalize('NFKC').trim().toLocaleLowerCase() ===
        normalizedTitle,
    );
    if (match) return match;
    if (!page.nextCursor) return null;
    cursor = page.nextCursor;
  }
  return null;
}

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

// ── 路由处理 ──────────────────────────────────────────────────────

/**
 * POST /api/v1/assistant/turn
 *
 * 小助手端点：意图识别 + 直接调已有 API。
 * 仅处理管理操作和产物创建，超出范围礼貌拒绝。
 */
export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin');
  }

  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');

  const rateLimit = checkAssistantRateLimit(`assistant:${identity.studentId}`);
  if (!rateLimit.allowed) {
    return jsonError(429, 'rate_limited');
  }

  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) {
    return jsonError(404, 'conversation_not_found');
  }

  let body: { text?: string; clientMessageId?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const text = (body.text ?? '').trim();
  if (!text || Buffer.byteLength(text, 'utf-8') > MAX_TEXT_BYTES) {
    return jsonError(400, 'invalid_message');
  }

  const repo = new DrizzlePlatformConversationRepository();
  const notebooks = await repo.listOwnedRecent({
    trustedSubjectId: identity.studentId,
    limit: 50,
  });

  let intent: Awaited<ReturnType<typeof classifyIntent>>;
  try {
    const deps = createAssistantClassifyDependencies();
    intent = await runClassifiedTurn(
      {
        text,
        notebooks: notebooks.map((n) => ({
          id: n.id,
          title: n.title ?? '未命名笔记本',
        })),
      },
      deps,
    );
  } catch (error) {
    if (
      error instanceof AssistantClassifyError &&
      error.code === 'budget_exceeded'
    ) {
      return jsonError(429, 'budget_exceeded');
    }
    return jsonError(503, 'assistant_unavailable');
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
        const now = Date.now();
        const dedupKey = body.clientMessageId
          ? `${identity.studentId}:${body.clientMessageId}`
          : null;
        if (dedupKey) {
          pruneNotebookCreateDedup(now);
          const existing = notebookCreateDedup.get(dedupKey);
          if (existing) {
            return jsonResponse({
              message: `已创建笔记本「${intent.title ?? '未命名笔记本'}」。`,
              action: 'created',
            });
          }
        }
        const notebookTitle = intent.title ?? '未命名笔记本';
        const created = await repo.create({
          ownerSubjectId: identity.studentId,
          spaceKind: 'notebook',
          spaceTitle: notebookTitle,
          conversationTitle: notebookTitle,
          agentProfileId: 'general',
        });
        await writeActiveConversationCookie(created.id);
        if (dedupKey) {
          notebookCreateDedup.set(dedupKey, { createdAt: now });
        }
        return jsonResponse({
          message: `已创建笔记本「${notebookTitle}」。`,
          action: 'created',
        });
      }

      case 'rename_notebook': {
        if (!intent.notebookId || !intent.title) {
          return jsonResponse({ message: '请指定要重命名的笔记本和新名称。' });
        }
        const renamed = await repo.renameOwned({
          conversationId: intent.notebookId,
          trustedSubjectId: identity.studentId,
          title: intent.title,
        });
        if (!renamed) {
          return jsonResponse({ message: '笔记本不存在或无权重命名。' });
        }
        // 如果重命名的是当前活跃笔记本，重写 cookie 保持引用一致。
        if (intent.notebookId === conversation.id) {
          await writeActiveConversationCookie(conversation.id);
        }
        return jsonResponse({
          message: `已重命名为「${renamed.title}」。`,
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
        // 如果删除的是当前活跃笔记本，清除 cookie 避免主对话页永久回退到入口页。
        if (intent.notebookId === conversation.id) {
          await clearActiveConversationCookie();
        }
        return jsonResponse({
          message: '已删除。',
          action: 'deleted',
        });
      }

      case 'switch_notebook': {
        if (!intent.notebookId && !intent.title) {
          return jsonResponse({ message: '请指定要切换到的笔记本。' });
        }
        // 分类 prompt 只携带最近 50 条以控制 token；没有列表 ID 时再通过受限
        // 分页解析更早的精确标题。模型给出的 ID 仍必须经过所有权查询。
        const target = intent.notebookId
          ? await repo.getOwned({
              conversationId: intent.notebookId!,
              trustedSubjectId: identity.studentId,
            })
          : await findAccessibleNotebookByTitle(
              repo,
              identity.studentId,
              intent.title!,
            );
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
    return jsonError(500, 'assistant_error');
  }
}
