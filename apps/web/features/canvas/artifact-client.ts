/**
 * 产物端点的浏览器客户端(M1 PR-J5b)。生成进度经轮询获取;SSE `artifact.*`
 * 事件生产者接通后轮询退化为兜底路径,函数签名不变。
 */

export interface ArtifactSummary {
  id: string;
  kind: string;
  trustTier: 'tier1' | 'tier2';
  title: string;
  status: 'proposed' | 'active' | 'archived';
  latestVersion: number;
}

export interface ArtifactDetail {
  artifact: ArtifactSummary;
  latestVersion: {
    version: number;
    content: unknown;
    media: AudioOverviewMedia | null;
  } | null;
  latestJob: {
    id: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    progress: number | null;
    failureCode: string | null;
  } | null;
}

export interface AudioOverviewMedia {
  url: string;
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

const ARTIFACTS_ENDPOINT = '/api/v1/chat/artifacts';

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`artifact request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export type CreatableArtifactKind =
  | 'mind_map'
  | 'slides'
  | 'flashcards'
  | 'audio_overview';

export interface ArtifactSourceReference {
  assetId: string;
  versionId: string;
  kind: 'document' | 'link';
}

export async function createArtifact(
  kind: CreatableArtifactKind,
  title: string,
  sources: readonly ArtifactSourceReference[] = [],
): Promise<{ artifact: ArtifactSummary; job: { id: string } }> {
  const response = await fetch(ARTIFACTS_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      kind === 'audio_overview' ? { kind, title, sources } : { kind, title },
    ),
  });
  return parseJsonOrThrow(response);
}

export async function fetchNotebookArtifacts(): Promise<
  readonly ArtifactSummary[]
> {
  const response = await fetch(ARTIFACTS_ENDPOINT);
  const data = await parseJsonOrThrow<{ artifacts: ArtifactSummary[] }>(
    response,
  );
  return data.artifacts;
}

export async function fetchArtifactDetail(
  artifactId: string,
): Promise<ArtifactDetail> {
  const response = await fetch(
    `${ARTIFACTS_ENDPOINT}/${encodeURIComponent(artifactId)}`,
  );
  return parseJsonOrThrow(response);
}

/**
 * 轮询直到生成任务落入 terminal 态或产生版本。超时不抛错而是返回最后一次
 * 详情——任务仍在后台跑(持久任务的本意),UI 应展示"仍在生成"而不是失败。
 */
export async function pollArtifactUntilSettled(
  artifactId: string,
  options: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ArtifactDetail> {
  const interval = options.intervalMs ?? 1_500;
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  let detail = await fetchArtifactDetail(artifactId);
  while (Date.now() < deadline && !options.signal?.aborted) {
    const jobStatus = detail.latestJob?.status;
    if (
      detail.artifact.latestVersion > 0 ||
      jobStatus === 'succeeded' ||
      jobStatus === 'failed' ||
      jobStatus === 'cancelled'
    ) {
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
    detail = await fetchArtifactDetail(artifactId);
  }
  return detail;
}
