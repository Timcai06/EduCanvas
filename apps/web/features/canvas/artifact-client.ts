/**
 * 产物端点的浏览器客户端(M1 PR-J5b)。生成进度经轮询获取;SSE `artifact.*`
 * 事件生产者接通后轮询退化为兜底路径,函数签名不变。
 */

import { z } from 'zod';
import { canvasResourceSchema } from '@educanvas/canvas-protocol';

export interface ArtifactSummary {
  id: string;
  kind: string;
  trustTier: 'tier1' | 'tier2';
  title: string;
  status: 'proposed' | 'active' | 'archived';
  latestVersion: number;
}

/** 产物详情里附带的溯源信息:产物是否由本对话生成、创建/更新时间。 */
export interface ArtifactProvenance {
  fromConversation: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactDetail {
  artifact: ArtifactSummary & ArtifactProvenance;
  version: {
    id: string;
    version: number;
    content: unknown;
    media: ArtifactMedia | null;
  } | null;
  versions: readonly {
    version: number;
    generatedBy: string | null;
    /** 该版本由用户的哪条修改要求生成;初始生成为 null。 */
    revisionInstruction: string | null;
    createdAt: string;
  }[];
  latestJob: {
    id: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    progress: number | null;
    failureCode: string | null;
  } | null;
  canvasResource?: z.infer<typeof canvasResourceSchema>;
}

export interface AudioOverviewMedia {
  url: string;
  downloadUrl?: string;
  contentVersion: 1;
  contentType: 'audio/mpeg';
  byteSize: number;
  transcript: string;
  sourceCount: number;
  script: {
    generator: string;
    provider: string | null;
    resolvedModelId: string | null;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  };
  speech: {
    provider: string;
    resolvedModelId: string;
    voice: string;
    inputCharacters: number;
    latencyMs: number;
  };
}

export interface GeneratedImageMedia {
  url: string;
  downloadUrl?: string;
  contentVersion: 1;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteSize: number;
  size: '512x512' | '1024x1024' | '1024x1536' | '1536x1024';
  image: {
    provider: string;
    resolvedModelId: string;
    latencyMs: number;
  };
}

export type ArtifactMedia = AudioOverviewMedia | GeneratedImageMedia;

/**
 * Artifact 版本的受控渲染数据：组合层打开时注入 Registry Renderer 的 `content` 槽。
 * 只携带版本的内容与媒体引用，不含原始存储地址、堆栈或内部对象键。
 */
export interface ArtifactVersionData {
  readonly content: unknown;
  readonly media: ArtifactMedia | null;
}

const ARTIFACTS_ENDPOINT = '/api/v1/chat/artifacts';

const artifactSummarySchema = z.object({
  id: z.string(),
  kind: z.string(),
  trustTier: z.enum(['tier1', 'tier2']),
  title: z.string(),
  status: z.enum(['proposed', 'active', 'archived']),
  latestVersion: z.number().int().min(0),
});

const artifactJobSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
});

const artifactMutationResponseSchema = z.object({
  artifact: artifactSummarySchema,
  job: artifactJobSchema.pick({ id: true }).nullable(),
});

const audioOverviewMediaSchema = z
  .object({
    url: z.string(),
    downloadUrl: z.string().optional(),
    contentVersion: z.literal(1),
    contentType: z.literal('audio/mpeg'),
    byteSize: z.number().int().nonnegative(),
    transcript: z.string(),
    sourceCount: z.number().int().nonnegative(),
    script: z
      .object({
        generator: z.string(),
        provider: z.string().nullable(),
        resolvedModelId: z.string().nullable(),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        latencyMs: z.number().int().nonnegative(),
      })
      .strict(),
    speech: z
      .object({
        provider: z.string(),
        resolvedModelId: z.string(),
        voice: z.string(),
        inputCharacters: z.number().int().nonnegative(),
        latencyMs: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

const generatedImageMediaSchema = z
  .object({
    url: z.string(),
    downloadUrl: z.string().optional(),
    contentVersion: z.literal(1),
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    size: z.enum(['512x512', '1024x1024', '1024x1536', '1536x1024']),
    image: z
      .object({
        provider: z.string().min(1).max(128),
        resolvedModelId: z.string().min(1).max(256),
        latencyMs: z.number().finite().nonnegative(),
      })
      .strict(),
  })
  .strict();

const artifactDetailSchema = z.object({
  artifact: artifactSummarySchema.extend({
    fromConversation: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  version: z
    .object({
      id: z.string().uuid(),
      version: z.number().int().min(1),
      content: z.unknown(),
      media: z
        .union([audioOverviewMediaSchema, generatedImageMediaSchema])
        .nullable(),
    })
    .nullable(),
  versions: z.array(
    z.object({
      version: z.number().int().min(1),
      generatedBy: z.string().nullable(),
      revisionInstruction: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  latestJob: artifactJobSchema
    .extend({
      progress: z.number().int().min(0).max(100).nullable(),
      failureCode: z.string().nullable(),
    })
    .nullable(),
  // R06/#306：服务端 projection 是 CanvasResource 唯一权威，client 用 canonical
  // schema 完整验证并保留（不再只取 allowedActions、不再在浏览器端按 kind 重建）。
  // 服务端协议非法时 parse 失败（fail closed），不允许浏览器自行修补。
  canvasResource: canvasResourceSchema.optional(),
});

async function parseJsonOrThrow<T>(
  response: Response,
  schema: z.ZodType<T>,
  invalidMessage: string,
): Promise<T> {
  if (!response.ok) {
    throw new Error(`artifact request failed with ${response.status}`);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new Error(invalidMessage);
  return parsed.data;
}

export type CreatableArtifactKind =
  | 'mind_map'
  | 'slides'
  | 'flashcards'
  | 'markdown_document'
  | 'audio_overview'
  | 'web_app'
  | 'note';

/** Agent 工具可产生、UI 可观察的种类；generated_image 不开放手动 POST 创建。 */
export type ObservableArtifactKind = CreatableArtifactKind | 'generated_image';

export function isCreatableArtifactKind(
  kind: string,
): kind is CreatableArtifactKind {
  return [
    'mind_map',
    'slides',
    'flashcards',
    'markdown_document',
    'audio_overview',
    'web_app',
    'note',
  ].includes(kind);
}

export interface ArtifactSourceReference {
  assetId: string;
  versionId: string;
  kind: 'document' | 'link';
}

export async function createArtifact(
  kind: CreatableArtifactKind,
  title: string,
  sources: readonly ArtifactSourceReference[] = [],
  markdown?: string,
): Promise<{ artifact: ArtifactSummary; job: { id: string } | null }> {
  const body: Record<string, unknown> = { kind, title };
  if (kind === 'audio_overview') body.sources = sources;
  if (kind === 'note' && markdown !== undefined) body.markdown = markdown;
  const response = await fetch(ARTIFACTS_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJsonOrThrow(
    response,
    artifactMutationResponseSchema,
    '产物创建响应格式不正确。',
  );
}

export async function fetchNotebookArtifacts(): Promise<
  readonly ArtifactSummary[]
> {
  const response = await fetch(ARTIFACTS_ENDPOINT);
  const data = await parseJsonOrThrow(
    response,
    z.object({ artifacts: z.array(artifactSummarySchema) }),
    '产物列表响应格式不正确。',
  );
  return data.artifacts;
}

export async function fetchArtifactDetail(
  artifactId: string,
  version?: number,
  options: { signal?: AbortSignal } = {},
): Promise<ArtifactDetail> {
  const query = version === undefined ? '' : `?version=${version}`;
  const response = await fetch(
    `${ARTIFACTS_ENDPOINT}/${encodeURIComponent(artifactId)}${query}`,
    { signal: options.signal },
  );
  return parseJsonOrThrow(
    response,
    artifactDetailSchema,
    '产物详情响应格式不正确。',
  );
}

export async function reviseArtifact(
  artifactId: string,
  baseVersion: number,
  instruction: string,
): Promise<{ artifact: ArtifactSummary; job: { id: string } | null }> {
  const response = await fetch(
    `${ARTIFACTS_ENDPOINT}/${encodeURIComponent(artifactId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'generate',
        baseVersion,
        instruction,
      }),
    },
  );
  return parseJsonOrThrow(
    response,
    artifactMutationResponseSchema,
    '产物修改响应格式不正确。',
  );
}

/** 从历史版本恢复为新版本；服务端会落一个新版本，不会移动最新版本指针。 */
export async function restoreArtifactVersion(
  artifactId: string,
  sourceVersion: number,
  expectedLatestVersion: number,
): Promise<{ artifact: ArtifactSummary; job: { id: string } | null }> {
  const response = await fetch(
    `${ARTIFACTS_ENDPOINT}/${encodeURIComponent(artifactId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'restore',
        sourceVersion,
        expectedLatestVersion,
      }),
    },
  );
  return parseJsonOrThrow(
    response,
    artifactMutationResponseSchema,
    '产物恢复响应格式不正确。',
  );
}

/** 直接保存 Markdown 笔记为新版本；它不创建模型任务或伪造 generation job。 */
export async function saveNoteArtifact(
  artifactId: string,
  baseVersion: number,
  markdown: string,
): Promise<{ artifact: ArtifactSummary; job: null }> {
  const response = await fetch(
    `${ARTIFACTS_ENDPOINT}/${encodeURIComponent(artifactId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'save_note',
        baseVersion,
        markdown,
      }),
    },
  );
  const result = await parseJsonOrThrow(
    response,
    artifactMutationResponseSchema,
    '笔记保存响应格式不正确。',
  );
  if (result.job !== null) {
    throw new Error('笔记保存不应创建生成任务。');
  }
  return { artifact: result.artifact, job: null };
}

/** 直接编辑 Markdown 文档；服务端按文档 schema 追加完整不可变版本。 */
export async function saveMarkdownDocumentArtifact(
  artifactId: string,
  baseVersion: number,
  markdown: string,
): Promise<{ artifact: ArtifactSummary; job: null }> {
  const response = await fetch(
    `${ARTIFACTS_ENDPOINT}/${encodeURIComponent(artifactId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'save_markdown_document',
        baseVersion,
        markdown,
      }),
    },
  );
  const result = await parseJsonOrThrow(
    response,
    artifactMutationResponseSchema,
    'Markdown 文档保存响应格式不正确。',
  );
  if (result.job !== null) {
    throw new Error('Markdown 文档保存不应创建生成任务。');
  }
  return { artifact: result.artifact, job: null };
}

export async function deleteArtifact(
  artifactId: string,
): Promise<{ deleted: boolean }> {
  const response = await fetch(
    `${ARTIFACTS_ENDPOINT}/${encodeURIComponent(artifactId)}`,
    {
      method: 'DELETE',
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const code = body?.error?.code ?? 'artifact_delete_failed';
    throw new Error(code);
  }
  return response.json();
}
