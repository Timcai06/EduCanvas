import { createHash } from 'node:crypto';
import {
  agentMessageInputSchema,
  agentMessagePartSchema,
  extractAgentMessageText,
  normalizeAgentMessageParts,
  referencedAssetVersions,
  type AgentMessagePart,
} from '@educanvas/agent-core';
import { asc, eq, inArray } from 'drizzle-orm';
import type { DatabaseExecutor } from './internal/database-types';
import {
  loadOwnedReadyAssetVersions,
  OwnedAssetVersionError,
} from './internal/owned-asset-versions';
import { agentMessageParts, assetVersions } from './schema';

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
  try {
    await loadOwnedReadyAssetVersions(executor, {
      ownerSubjectId: input.ownerSubjectId,
      spaceId: input.spaceId,
      references,
    });
  } catch (error) {
    if (error instanceof OwnedAssetVersionError) {
      throw new MessagePartValidationError(
        error.reason === 'invalid_reference'
          ? 'Asset引用格式无效'
          : 'Asset不存在、未就绪或不属于当前空间',
      );
    }
    throw error;
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
