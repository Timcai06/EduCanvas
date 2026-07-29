/**
 * 产物端点的浏览器客户端(M1 PR-J5b)。生成进度经轮询获取;SSE `artifact.*`
 * 事件生产者接通后轮询退化为兜底路径,函数签名不变。
 */

import { z } from 'zod';
import {
  canvasResourceActionSchema,
  type CanvasResourceAction,
} from '@educanvas/canvas-protocol';

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
  canvasResource?: {
    allowedActions: readonly CanvasResourceAction[];
  };
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
  canvasResource: z
    .object({
      allowedActions: z.array(canvasResourceActionSchema).max(16),
    })
    .strict()
    .optional(),
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
  'mind_map' | 'slides' | 'flashcards' | 'audio_overview' | 'note';

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
): Promise<ArtifactDetail> {
  const query = version === undefined ? '' : `?version=${version}`;
  const response = await fetch(
    `${ARTIFACTS_ENDPOINT}/${encodeURIComponent(artifactId)}${query}`,
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

/**
 * 轮询直到生成任务落入 terminal 态或产生版本。超时不抛错而是返回最后一次
 * 详情——任务仍在后台跑(持久任务的本意),UI 应展示"仍在生成"而不是失败。
 */
export async function pollArtifactUntilSettled(
  artifactId: string,
  options: {
    intervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    minimumVersion?: number;
  } = {},
): Promise<ArtifactDetail> {
  const interval = options.intervalMs ?? 1_500;
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  let detail = await fetchArtifactDetail(artifactId);
  while (Date.now() < deadline && !options.signal?.aborted) {
    const jobStatus = detail.latestJob?.status;
    const minimumVersion = options.minimumVersion ?? 1;
    if (jobStatus === 'failed' || jobStatus === 'cancelled') {
      return detail;
    }
    if (
      detail.artifact.latestVersion >= minimumVersion &&
      (jobStatus === 'succeeded' || jobStatus === undefined)
    ) {
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
    detail = await fetchArtifactDetail(artifactId);
  }
  return detail;
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
