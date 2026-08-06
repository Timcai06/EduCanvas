/**
 * V15 音频硬删除 Worker 集成测试共享环境与数据构造。
 * 覆盖撤回/到期真实删除闭环（V15-D/E）与失败恢复矩阵（V15-F）。
 * 所有 storageKey/sourceId/subject 使用 randomUUID；afterEach 清理本文件
 * 创建的全部行，afterAll 删除临时对象目录，重复运行无唯一键冲突或残留。
 */
/**
 * 这组测试会禁用不可删除触发器并清理行，必须在加载 Repository 前拒绝任何
 * 非测试数据库。与 packages/db 集成门禁保持同一后缀纪律。
 */
function resolveTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL未设置');
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error(
      '集成测试数据库名必须以_integration或_test结尾，拒绝连接非测试数据库',
    );
  }
  return value;
}

/** 指向隔离集成库：getDb() 惰性读取，首次访问发生在本门禁之后。 */
process.env.DATABASE_URL = resolveTestDatabaseUrl();

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalObjectStorage } from '@educanvas/agent-runtime';
import { ObjectStorageError } from '@educanvas/agent-core';
import {
  AudioRetentionRepository,
  DrizzleObjectDeletionOutboxRepository,
  assetVersions,
  assets,
  audioConsents,
  audioRetentions,
  objectDeletionOutbox,
  platformUsers,
  securityAuditEvents,
  spaces,
  type ObjectDeletionClaim,
} from '@educanvas/db';
import { getDb } from '@educanvas/db/testing';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createDeleteObjectOutboxTask } from './tasks/delete-object-outbox.js';

export const database = getDb();

/** 隔离对象存储根：本文件全部真实字节写入此处，绝不触碰仓库 uploads。 */
export const objectStorageRoot = mkdtempSync(
  path.join(tmpdir(), 'educanvas-delete-outbox-'),
);
const originalAssetStorageRoot = process.env.ASSET_STORAGE_ROOT;
process.env.ASSET_STORAGE_ROOT = objectStorageRoot;

/** 测试内自建对象存储（写真实字节、验证删除）。 */
export const storage = new LocalObjectStorage(objectStorageRoot);

export const outboxRepository = new DrizzleObjectDeletionOutboxRepository(
  database,
);
export const retentionRepository = new AudioRetentionRepository({ database });

interface TestIds {
  users: string[];
  spaces: string[];
  assets: string[];
  versions: string[];
  consents: string[];
  retentions: string[];
  outbox: string[];
}
export const ids: TestIds = {
  users: [],
  spaces: [],
  assets: [],
  versions: [],
  consents: [],
  retentions: [],
  outbox: [],
};

export function track<T extends { id: string }>(list: string[], row: T): T {
  list.push(row.id);
  return row;
}

export async function seedUser() {
  const id = `user-${randomUUID()}`;
  ids.users.push(id);
  await database
    .insert(platformUsers)
    .values({ id, kind: 'registered', status: 'active' });
  return id;
}

export async function seedAudioAssetVersion(subjectUserId: string) {
  const space = track(
    ids.spaces,
    await database
      .insert(spaces)
      .values({
        ownerSubjectId: subjectUserId,
        kind: 'personal',
        title: 'V15 测试空间',
        status: 'active',
      })
      .returning()
      .then((rows) => rows[0]!),
  );
  const asset = track(
    ids.assets,
    await database
      .insert(assets)
      .values({
        ownerSubjectId: subjectUserId,
        spaceId: space.id,
        scope: 'turn',
        kind: 'audio',
        origin: 'upload',
        displayName: 'V15 测试音频',
        status: 'pending',
      })
      .returning()
      .then((rows) => rows[0]!),
  );
  const storageKey = `audio-${randomUUID()}`;
  const version = track(
    ids.versions,
    await database
      .insert(assetVersions)
      .values({
        assetId: asset.id,
        kind: 'audio',
        mimeType: 'audio/wav',
        byteSize: 1024,
        contentHash: 'a'.repeat(64),
        status: 'ready',
        storageKey,
      })
      .returning()
      .then((rows) => rows[0]!),
  );
  return { versionId: version.id, storageKey };
}

export async function seedConsent(subjectUserId: string) {
  const row = track(
    ids.consents,
    await database
      .insert(audioConsents)
      .values({
        subjectUserId,
        grantorUserId: subjectUserId,
        authorizationType: 'self',
        proofMethod: 'adult_self_attested',
        proofReference: `assertion:${randomUUID()}`,
        purpose: 'audio_retention',
        consentVersion: 'v1',
        noticeVersion: 'notice-1',
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000),
      })
      .returning()
      .then((rows) => rows[0]!),
  );
  return row;
}

export async function seedOutboxRow(input: {
  storageKey: string;
  status?: 'pending' | 'processing';
  attempts?: number;
  availableAt?: Date;
  claimedAt?: Date | null;
  sourceId?: string;
}) {
  const row = track(
    ids.outbox,
    await database
      .insert(objectDeletionOutbox)
      .values({
        objectKind: 'asset',
        storageKey: input.storageKey,
        sourceType: 'asset_version',
        sourceId: input.sourceId ?? randomUUID(),
        status: input.status ?? 'pending',
        attempts: input.attempts ?? 0,
        availableAt: input.availableAt ?? new Date(),
        claimedAt: input.claimedAt ?? null,
      })
      .returning()
      .then((rows) => rows[0]!),
  );
  return row;
}

export async function writeObject(storageKey: string) {
  await storage.put({ key: storageKey, bytes: new Uint8Array([1, 2, 3, 4]) });
}

export async function objectExists(storageKey: string) {
  try {
    await storage.read(storageKey);
    return true;
  } catch (error) {
    if (
      error instanceof ObjectStorageError &&
      error.code === 'object_not_found'
    ) {
      return false;
    }
    throw error;
  }
}

export async function outboxRow(id: string) {
  const rows = await database
    .select()
    .from(objectDeletionOutbox)
    .where(eq(objectDeletionOutbox.id, id));
  return rows[0];
}

/** 收集全部日志文本，供"无 storageKey/路径/stack"断言。 */
export function makeLogger() {
  const lines: string[] = [];
  const logger = {
    info: (...args: unknown[]) => lines.push(args.join(' ')),
    error: (...args: unknown[]) => lines.push(args.join(' ')),
  };
  return { lines, logger };
}

export function makeTask(
  repository: TaskRepository = outboxRepository,
  deleter: TaskDeleter = realDeleter,
) {
  return createDeleteObjectOutboxTask(repository, deleter);
}

interface TaskRepository {
  claimBatch(input: { limit: number }): Promise<readonly ObjectDeletionClaim[]>;
  complete(id: string, attempt: number): Promise<void>;
  fail(
    id: string,
    input: { failureCode: string; attempt: number },
  ): Promise<void>;
}

interface TaskDeleter {
  delete(claim: ObjectDeletionClaim): Promise<void>;
}

export const realDeleter = {
  delete: (claim: ObjectDeletionClaim) => storage.delete(claim.storageKey),
};

export async function cleanup() {
  if (ids.outbox.length || ids.versions.length) {
    // 兜底：撤回/到期产生的 Outbox 意图按 sourceId（assetVersionId）一并清理，
    // 不依赖每个用例显式登记 outbox id。
    await database
      .delete(objectDeletionOutbox)
      .where(
        or(
          inArray(objectDeletionOutbox.id, ids.outbox),
          inArray(objectDeletionOutbox.sourceId, ids.versions),
        ),
      );
  }
  if (ids.retentions.length) {
    // retention 是数据库层不可变审计事实（audio_retentions_no_delete 禁删），
    // 测试清理需临时禁用该 DELETE 触发器，finally 恢复，避免残留污染共享库。
    await database.execute(
      sql`alter table audio_retentions disable trigger audio_retentions_no_delete`,
    );
    try {
      await database
        .delete(audioRetentions)
        .where(inArray(audioRetentions.id, ids.retentions));
    } finally {
      await database.execute(
        sql`alter table audio_retentions enable trigger audio_retentions_no_delete`,
      );
    }
  }
  if (ids.consents.length) {
    await database.execute(
      sql`alter table audio_consents disable trigger audio_consents_no_delete`,
    );
    try {
      await database
        .delete(audioConsents)
        .where(inArray(audioConsents.id, ids.consents));
      // 审计事件 resourceId 是 retention.id（readRetention 写入），口径需覆盖留存。
      await database
        .delete(securityAuditEvents)
        .where(
          or(
            inArray(securityAuditEvents.resourceId, ids.consents),
            inArray(securityAuditEvents.resourceId, ids.retentions),
          ),
        );
    } finally {
      await database.execute(
        sql`alter table audio_consents enable trigger audio_consents_no_delete`,
      );
    }
  }
  if (ids.versions.length) {
    await database
      .delete(assetVersions)
      .where(inArray(assetVersions.id, ids.versions));
  }
  if (ids.assets.length) {
    await database.delete(assets).where(inArray(assets.id, ids.assets));
  }
  if (ids.spaces.length) {
    await database.delete(spaces).where(inArray(spaces.id, ids.spaces));
  }
  if (ids.users.length) {
    await database
      .delete(platformUsers)
      .where(inArray(platformUsers.id, ids.users));
  }
  ids.users = [];
  ids.spaces = [];
  ids.assets = [];
  ids.versions = [];
  ids.consents = [];
  ids.retentions = [];
  ids.outbox = [];
}

beforeAll(async () => {
  await migrate(database, {
    migrationsFolder: fileURLToPath(
      new URL('../../../packages/db/drizzle', import.meta.url),
    ),
  });
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  rmSync(objectStorageRoot, { recursive: true, force: true });
  // 恢复进程环境变量原值（而非仅删除），避免指向已删临时目录的残留影响同进程其他测试。
  if (originalAssetStorageRoot === undefined) {
    delete process.env.ASSET_STORAGE_ROOT;
  } else {
    process.env.ASSET_STORAGE_ROOT = originalAssetStorageRoot;
  }
});
