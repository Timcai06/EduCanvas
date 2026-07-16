import { createHash } from 'node:crypto';
import {
  agentMessageInputSchema,
  agentMessagePartSchema,
  extractAgentMessageText,
  normalizeAgentMessageParts,
  referencedAssetVersions,
  type AgentMessagePart,
} from '@educanvas/agent-core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from './client';
import { agentMessageParts, assets, assetVersions } from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
export type DatabaseExecutor = Database | DatabaseTransaction;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MessagePartValidationError extends Error {
  readonly code = 'invalid_message_parts';

  constructor(message: string) {
    super(message);
    this.name = 'MessagePartValidationError';
  }
}

export interface PreparedStudentMessage {
  content: string;
  parts: readonly AgentMessagePart[];
  requestHash: string;
}

export function prepareStudentMessage(input: {
  clientMessageId: string;
  text?: string;
  parts?: readonly AgentMessagePart[];
}): PreparedStudentMessage {
  const sourceParts = input.parts ?? [
    { type: 'text' as const, text: input.text ?? '' },
  ];
  const parsed = agentMessageInputSchema.safeParse({
    clientMessageId: input.clientMessageId,
    parts: sourceParts,
  });
  if (!parsed.success) {
    throw new MessagePartValidationError('消息Part格式无效');
  }
  const parts = normalizeAgentMessageParts(parsed.data.parts);
  const content = extractAgentMessageText(parts);
  if (content.length > 4_000) {
    throw new MessagePartValidationError('学生消息不能超过4000字符');
  }
  const requestHash = createHash('sha256')
    .update(JSON.stringify(parts), 'utf8')
    .digest('hex');
  return { content, parts, requestHash };
}

export async function assertOwnedReadyAssetParts(
  executor: DatabaseExecutor,
  input: {
    ownerSubjectId: string;
    spaceId: string;
    parts: readonly AgentMessagePart[];
  },
): Promise<void> {
  const references = referencedAssetVersions(input.parts);
  if (references.length === 0) return;
  if (
    !UUID.test(input.spaceId) ||
    references.some(
      (reference) =>
        !UUID.test(reference.assetId) || !UUID.test(reference.versionId),
    )
  ) {
    throw new MessagePartValidationError('Asset引用格式无效');
  }
  const rows = await executor
    .select({ asset: assets, version: assetVersions })
    .from(assetVersions)
    .innerJoin(assets, eq(assets.id, assetVersions.assetId))
    .where(
      and(
        eq(assets.ownerSubjectId, input.ownerSubjectId),
        eq(assets.spaceId, input.spaceId),
        eq(assets.status, 'ready'),
        eq(assetVersions.status, 'ready'),
        inArray(
          assetVersions.id,
          references.map((reference) => reference.versionId),
        ),
      ),
    );
  const byVersion = new Map(rows.map((row) => [row.version.id, row]));
  for (const reference of references) {
    const row = byVersion.get(reference.versionId);
    if (
      !row ||
      row.asset.id !== reference.assetId ||
      row.asset.currentVersionId !== reference.versionId ||
      row.asset.kind !== reference.kind ||
      row.version.kind !== reference.kind
    ) {
      throw new MessagePartValidationError(
        'Asset不存在、未就绪或不属于当前空间',
      );
    }
  }
}

export async function insertMessageParts(
  executor: DatabaseExecutor,
  messageId: string,
  parts: readonly AgentMessagePart[],
): Promise<void> {
  if (parts.length === 0) return;
  await executor.insert(agentMessageParts).values(
    parts.map((part, partIndex) => {
      if (part.type === 'text') {
        return {
          messageId,
          partIndex,
          partType: part.type,
          textContent: part.text,
        };
      }
      if (part.type === 'asset_ref') {
        return {
          messageId,
          partIndex,
          partType: part.type,
          assetId: part.reference.assetId,
          assetVersionId: part.reference.versionId,
          assetUsage: part.usage,
        };
      }
      return {
        messageId,
        partIndex,
        partType: part.type,
        artifactId: part.artifactId,
        artifactVersionId: part.versionId,
        artifactKind: part.kind,
      };
    }),
  );
}

export async function loadMessageParts(
  executor: DatabaseExecutor,
  messageIds: readonly string[],
): Promise<ReadonlyMap<string, readonly AgentMessagePart[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await executor
    .select({ part: agentMessageParts, assetKind: assetVersions.kind })
    .from(agentMessageParts)
    .leftJoin(
      assetVersions,
      eq(assetVersions.id, agentMessageParts.assetVersionId),
    )
    .where(inArray(agentMessageParts.messageId, [...messageIds]))
    .orderBy(
      asc(agentMessageParts.messageId),
      asc(agentMessageParts.partIndex),
    );
  const grouped = new Map<string, AgentMessagePart[]>();
  for (const row of rows) {
    const stored = row.part;
    const part = agentMessagePartSchema.parse(
      stored.partType === 'text'
        ? { type: 'text', text: stored.textContent }
        : stored.partType === 'asset_ref'
          ? {
              type: 'asset_ref',
              reference: {
                assetId: stored.assetId,
                versionId: stored.assetVersionId,
                kind: row.assetKind,
              },
              usage: stored.assetUsage,
            }
          : {
              type: 'artifact_ref',
              artifactId: stored.artifactId,
              versionId: stored.artifactVersionId,
              kind: stored.artifactKind,
            },
    );
    const current = grouped.get(stored.messageId) ?? [];
    current.push(part);
    grouped.set(stored.messageId, current);
  }
  return grouped;
}
