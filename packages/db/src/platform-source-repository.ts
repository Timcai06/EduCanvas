import { and, asc, eq, max, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  agentOperations,
  assets,
  assetVersions,
  conversationMessageCitations,
  conversationMessages,
  conversations,
  operationSources,
} from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export interface PlatformOperationSourceSnapshot {
  id: string;
  operationId: string;
  kind: 'web';
  ordinal: number;
  assetId: string;
  assetVersionId: string;
  label: string;
  url: string;
}

export interface PlatformMessageCitationSnapshot extends PlatformOperationSourceSnapshot {
  citationId: string;
  assistantMessageId: string;
}

export class PlatformSourceOwnershipError extends Error {
  readonly code = 'source_not_available';

  constructor() {
    super('来源不存在、不可用或不属于当前通用对话');
    this.name = 'PlatformSourceOwnershipError';
  }
}

function normalizePublicUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PlatformSourceOwnershipError();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new PlatformSourceOwnershipError();
  }
  url.hash = '';
  const normalized = url.toString();
  if (normalized.length > 2_048) throw new PlatformSourceOwnershipError();
  return normalized;
}

function normalizeLabel(value: string): string {
  const label = [...value.normalize('NFC').trim()].slice(0, 400).join('');
  if (!label) throw new PlatformSourceOwnershipError();
  return label;
}

function toSource(input: {
  source: typeof operationSources.$inferSelect;
  assetId: string;
}): PlatformOperationSourceSnapshot {
  return {
    id: input.source.id,
    operationId: input.source.operationId,
    kind: 'web',
    ordinal: input.source.ordinal,
    assetId: input.assetId,
    assetVersionId: input.source.assetVersionId,
    label: input.source.label,
    url: input.source.locatorUrl,
  };
}

async function listOwnedCitations(
  transaction: Database | DatabaseTransaction,
  input: {
    conversationId: string;
    trustedSubjectId: string;
    assistantMessageId?: string;
  },
): Promise<PlatformMessageCitationSnapshot[]> {
  const filters = [
    eq(conversations.id, input.conversationId),
    eq(conversations.ownerSubjectId, input.trustedSubjectId),
    eq(conversationMessages.conversationId, input.conversationId),
    eq(conversationMessages.role, 'assistant'),
    eq(conversationMessages.operationId, agentOperations.id),
    eq(operationSources.operationId, agentOperations.id),
  ];
  if (input.assistantMessageId) {
    filters.push(eq(conversationMessages.id, input.assistantMessageId));
  }
  const rows = await transaction
    .select({
      citationId: conversationMessageCitations.id,
      assistantMessageId: conversationMessages.id,
      source: operationSources,
      assetId: assetVersions.assetId,
    })
    .from(conversationMessageCitations)
    .innerJoin(
      conversationMessages,
      eq(
        conversationMessages.id,
        conversationMessageCitations.assistantMessageId,
      ),
    )
    .innerJoin(
      operationSources,
      eq(operationSources.id, conversationMessageCitations.operationSourceId),
    )
    .innerJoin(
      assetVersions,
      eq(assetVersions.id, operationSources.assetVersionId),
    )
    .innerJoin(
      agentOperations,
      eq(agentOperations.id, conversationMessages.operationId),
    )
    .innerJoin(
      conversations,
      eq(conversations.id, agentOperations.conversationId),
    )
    .where(and(...filters))
    .orderBy(
      asc(conversationMessages.createdAt),
      asc(operationSources.ordinal),
    );
  return rows.map((row) => ({
    citationId: row.citationId,
    assistantMessageId: row.assistantMessageId,
    ...toSource({ source: row.source, assetId: row.assetId }),
  }));
}

/**
 * 通用来源仓储：只接受服务端已经落盘并标记 ready 的不可变 AssetVersion，
 * 再为运行中的 Operation 分配稳定的 1..99 编号。
 */
export class DrizzlePlatformSourceRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async createOrGetWebSource(input: {
    conversationId: string;
    trustedSubjectId: string;
    operationId: string;
    assetId: string;
    assetVersionId: string;
    label: string;
    url: string;
    now?: Date;
  }): Promise<PlatformOperationSourceSnapshot> {
    const url = normalizePublicUrl(input.url);
    const label = normalizeLabel(input.label);
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`operation-sources-v1:${input.operationId}`}, 0))`,
      );
      const [owned] = await transaction
        .select({ operationId: agentOperations.id })
        .from(agentOperations)
        .innerJoin(
          conversations,
          eq(conversations.id, agentOperations.conversationId),
        )
        .innerJoin(assetVersions, eq(assetVersions.id, input.assetVersionId))
        .innerJoin(assets, eq(assets.id, assetVersions.assetId))
        .where(
          and(
            eq(agentOperations.id, input.operationId),
            eq(agentOperations.conversationId, input.conversationId),
            eq(agentOperations.kind, 'turn'),
            eq(agentOperations.status, 'running'),
            eq(conversations.ownerSubjectId, input.trustedSubjectId),
            eq(conversations.status, 'active'),
            eq(assets.id, input.assetId),
            eq(assets.ownerSubjectId, input.trustedSubjectId),
            eq(assets.spaceId, conversations.spaceId),
            eq(assets.kind, 'link'),
            eq(assets.status, 'ready'),
            eq(assets.currentVersionId, input.assetVersionId),
            eq(assetVersions.status, 'ready'),
          ),
        )
        .limit(1);
      if (!owned) throw new PlatformSourceOwnershipError();

      const [existing] = await transaction
        .select({ source: operationSources, assetId: assetVersions.assetId })
        .from(operationSources)
        .innerJoin(
          assetVersions,
          eq(assetVersions.id, operationSources.assetVersionId),
        )
        .where(
          and(
            eq(operationSources.operationId, input.operationId),
            eq(operationSources.locatorUrl, url),
          ),
        )
        .limit(1);
      if (existing) return toSource(existing);

      const [maximum] = await transaction
        .select({ ordinal: max(operationSources.ordinal) })
        .from(operationSources)
        .where(eq(operationSources.operationId, input.operationId));
      const ordinal = (maximum?.ordinal ?? 0) + 1;
      if (ordinal > 99) throw new PlatformSourceOwnershipError();
      const [source] = await transaction
        .insert(operationSources)
        .values({
          operationId: input.operationId,
          assetVersionId: input.assetVersionId,
          kind: 'web',
          ordinal,
          label,
          locatorUrl: url,
          createdAt: input.now,
        })
        .returning();
      if (!source) throw new Error('Operation来源写入失败');
      return toSource({ source, assetId: input.assetId });
    });
  }

  async listOwnedConversationCitations(input: {
    conversationId: string;
    trustedSubjectId: string;
  }): Promise<readonly PlatformMessageCitationSnapshot[]> {
    return listOwnedCitations(this.database, input);
  }

  async listOwnedMessageCitations(input: {
    conversationId: string;
    trustedSubjectId: string;
    assistantMessageId: string;
  }): Promise<readonly PlatformMessageCitationSnapshot[]> {
    return listOwnedCitations(this.database, input);
  }
}
