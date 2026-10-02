import 'server-only';

import { DrizzlePlatformArtifactTurnReferenceRepository } from '@educanvas/db';

const references = new DrizzlePlatformArtifactTurnReferenceRepository();
const KINDS = new Set([
  'mind_map',
  'slides',
  'flashcards',
  'note',
  'markdown_document',
  'web_app',
  'audio_overview',
  'generated_image',
  'picturebook',
]);
const GENERATION_STATUSES = new Set([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 只给本轮已选历史补充受身份与 Notebook 限制的事实，不重放模型标题或正文。 */
export async function loadGeneralArtifactStatusContext(input: {
  conversationId: string;
  notebookId: string;
  trustedSubjectId: string;
  operationIds: readonly string[];
}): Promise<string | null> {
  const operationIds = [...new Set(input.operationIds)].slice(-24);
  if (operationIds.length === 0) return null;
  const rows = await references.listForOperations({
    conversationId: input.conversationId,
    trustedSubjectId: input.trustedSubjectId,
    operationIds,
  });
  const selectedOperations = new Set(operationIds);
  const latestByArtifact = new Map<
    string,
    {
      artifactId: string;
      kind: string;
      generation: string;
      availableVersion: number;
      archived: boolean;
    }
  >();
  for (const row of rows) {
    const artifact = row.artifact;
    if (
      !selectedOperations.has(row.operationId) ||
      artifact.conversationId !== input.conversationId ||
      artifact.spaceId !== input.notebookId ||
      artifact.ownerSubjectId !== input.trustedSubjectId ||
      !UUID.test(artifact.id) ||
      !KINDS.has(artifact.kind) ||
      !GENERATION_STATUSES.has(row.generationStatus) ||
      !Number.isSafeInteger(artifact.latestVersion) ||
      artifact.latestVersion < 0
    ) {
      continue;
    }
    latestByArtifact.set(artifact.id, {
      artifactId: artifact.id,
      kind: artifact.kind,
      generation: row.generationStatus,
      availableVersion:
        artifact.status === 'active' ? artifact.latestVersion : 0,
      archived: artifact.status === 'archived',
    });
  }
  const facts = [...latestByArtifact.values()].slice(-100);
  if (facts.length === 0) return null;
  return `以下是本轮准备时从服务端读取的历史产物状态，不是模型自述。queued/running 只表示正在生成；failed/cancelled 不能称为生成完成。availableVersion 大于0表示已有可用版本，修订失败不撤销该版本；archived 表示已归档。仅按这些快照事实描述状态，不推测之后已经完成，也不要声称已查看产物内容。\n${JSON.stringify(facts)}`;
}
