import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  audioConsentProofMethods,
  audioConsentPurposes,
  audioConsents,
  audioRetentions,
} from './schema/audio-consent';
import { assetVersions, assets, platformUsers, spaces } from './schema';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
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

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 2 })
  : null;
const db = connection ? drizzle(connection) : null;

function getDb() {
  if (!db) throw new Error('TEST_DATABASE_URL未设置');
  return db;
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedUser(id = `user-${randomUUID()}`) {
  await getDb()
    .insert(platformUsers)
    .values({ id, kind: 'registered', status: 'active' });
  return id;
}

async function seedAssetVersion() {
  const space = await getDb()
    .insert(spaces)
    .values({
      ownerSubjectId: 'space-owner',
      kind: 'personal',
      title: '测试空间',
      status: 'active',
    })
    .returning();
  const asset = await getDb()
    .insert(assets)
    .values({
      ownerSubjectId: 'space-owner',
      spaceId: space[0]!.id,
      scope: 'turn',
      kind: 'audio',
      origin: 'upload',
      displayName: '测试音频',
      status: 'pending',
    })
    .returning();
  const version = await getDb()
    .insert(assetVersions)
    .values({
      assetId: asset[0]!.id,
      kind: 'audio',
      mimeType: 'audio/wav',
      byteSize: 1024,
      contentHash: 'a'.repeat(64),
      status: 'ready',
      storageKey: `audio-key-${randomUUID()}`,
    })
    .returning();
  return { assetId: asset[0]!.id, versionId: version[0]!.id };
}

async function seedConsent(input: {
  subjectUserId: string;
  grantorUserId?: string;
  authorizationType?: 'self' | 'guardian';
  proofMethod?: (typeof audioConsentProofMethods)[number];
  proofReference?: string;
  purpose?: string;
  grantedAt?: Date;
  expiresAt: Date;
}) {
  const authorizationType = input.authorizationType ?? 'self';
  const [row] = await getDb()
    .insert(audioConsents)
    .values({
      subjectUserId: input.subjectUserId,
      grantorUserId: input.grantorUserId ?? input.subjectUserId,
      authorizationType,
      proofMethod:
        input.proofMethod ??
        (authorizationType === 'self'
          ? 'adult_self_attested'
          : 'guardian_self_attested'),
      proofReference: input.proofReference ?? `assertion:${randomUUID()}`,
      purpose: input.purpose ?? 'audio_retention',
      consentVersion: 'v1',
      noticeVersion: 'notice-1',
      grantedAt: input.grantedAt ?? new Date(Date.now() - 60_000),
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!row) throw new Error('seed consent failed');
  return row;
}

async function seedRetention(input: {
  subjectUserId: string;
  consentId: string;
  assetVersionId: string;
  consentPurpose?: string;
  createdAt?: Date;
  expiresAt?: Date;
}) {
  const createdAt = input.createdAt ?? new Date();
  return getDb()
    .insert(audioRetentions)
    .values({
      subjectUserId: input.subjectUserId,
      consentId: input.consentId,
      consentPurpose: input.consentPurpose ?? 'audio_retention',
      assetVersionId: input.assetVersionId,
      createdAt,
      expiresAt: input.expiresAt ?? new Date(createdAt.getTime() + 3 * DAY_MS),
    })
    .returning();
}

/**
 * drizzle 把 postgres-js 的 server 错误放在 error.cause（PostgresError）里，
 * error.message 只有 SQL 文本；这里统一检查 cause.message 或顶层 message。
 */
async function expectServerViolation(
  promise: Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  try {
    await promise;
    throw new Error('期望被拒绝');
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    expect(cause?.message ?? String(error)).toMatch(pattern);
  }
}

describeWithDatabase('audio consent 与留存 schema', () => {
  beforeAll(async () => {
    if (!connection) throw new Error('TEST_DATABASE_URL未设置');
    await migrate(drizzle(connection, { schema: {} as never }), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  afterAll(async () => {
    await connection?.end({ timeout: 5 });
  });

  it('migration 正向应用：两张表与触发器存在', async () => {
    const tables = await connection!<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('audio_consents', 'audio_retentions')
      order by table_name
    `;
    expect(tables.map((row) => row.table_name)).toEqual([
      'audio_consents',
      'audio_retentions',
    ]);
    const triggers = await connection!<{ trigger_name: string }[]>`
      select trigger_name from information_schema.triggers
      where event_object_table in ('audio_consents', 'audio_retentions')
        and trigger_name in (
          'audio_consents_immutable',
          'audio_consents_no_delete',
          'audio_retentions_consent_valid',
          'audio_retentions_immutable',
          'audio_retentions_no_delete'
        )
      order by trigger_name
    `;
    expect(triggers.map((row) => row.trigger_name)).toEqual([
      'audio_consents_immutable',
      'audio_consents_no_delete',
      'audio_retentions_consent_valid',
      'audio_retentions_immutable',
      'audio_retentions_no_delete',
    ]);
  });

  it('public schema 不包含 storageKey、音频字节或转录文本列', async () => {
    const columns = await connection!<
      { table_name: string; column_name: string }[]
    >`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('audio_consents', 'audio_retentions')
    `;
    const names = columns.map((row) => row.column_name);
    expect(names).not.toContain('storage_key');
    expect(names).not.toContain('audio_bytes');
    expect(names).not.toContain('pcm_bytes');
    expect(names).not.toContain('transcription_text');
    expect(names).not.toContain('prompt');
  });

  it('三类 consent purpose 独立存在、互不替代', async () => {
    const subject = await seedUser();
    const expiresAt = new Date(Date.now() + 90 * DAY_MS);
    const created: Record<string, string> = {};
    for (const purpose of audioConsentPurposes) {
      const consent = await seedConsent({
        subjectUserId: subject,
        purpose,
        expiresAt,
      });
      created[purpose] = consent.id;
    }

    // 撤回 voice_processing 不影响其余两个 active。
    await getDb()
      .update(audioConsents)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(audioConsents.id, created.voice_processing!));
    const active = await getDb()
      .select({ purpose: audioConsents.purpose })
      .from(audioConsents)
      .where(
        and(
          eq(audioConsents.subjectUserId, subject),
          eq(audioConsents.status, 'active'),
        ),
      );
    expect(active.map((row) => row.purpose).sort()).toEqual([
      'audio_retention',
      'cloud_transcription',
    ]);

    // 撤回后 voice_processing 可重新征求；audio_retention 仍 active 时再插同目的被拒绝。
    await seedConsent({
      subjectUserId: subject,
      purpose: 'voice_processing',
      expiresAt,
    });
    await expect(
      seedConsent({
        subjectUserId: subject,
        purpose: 'audio_retention',
        expiresAt,
      }),
    ).rejects.toThrow();
  });

  it('adult self 与 guardian 结构由 authorizationType 和 proofMethod 共同强制', async () => {
    const adult = await seedUser();
    const child = await seedUser();
    const guardian = await seedUser();
    const expiresAt = new Date(Date.now() + 90 * DAY_MS);

    // self 形态要求 grantor = subject。
    await expect(
      seedConsent({
        subjectUserId: adult,
        grantorUserId: guardian,
        authorizationType: 'self',
        expiresAt,
      }),
    ).rejects.toThrow();
    // self 不能冒充 guardian proof，guardian 也不能复用 adult proof。
    await expect(
      seedConsent({
        subjectUserId: adult,
        authorizationType: 'self',
        proofMethod: 'guardian_verified',
        expiresAt,
      }),
    ).rejects.toThrow();
    await expect(
      seedConsent({
        subjectUserId: child,
        grantorUserId: guardian,
        authorizationType: 'guardian',
        proofMethod: 'adult_verified',
        expiresAt,
      }),
    ).rejects.toThrow();
    // guardian 形态要求 grantor ≠ subject。
    await expect(
      seedConsent({
        subjectUserId: child,
        grantorUserId: child,
        authorizationType: 'guardian',
        expiresAt,
      }),
    ).rejects.toThrow();
    // 两种合法形态（不同 subject，避免同主体同目的 active 唯一冲突）。
    await seedConsent({
      subjectUserId: adult,
      authorizationType: 'self',
      expiresAt,
    });
    await seedConsent({
      subjectUserId: child,
      grantorUserId: guardian,
      authorizationType: 'guardian',
      expiresAt,
    });
  });

  it('不把 age_band 当作授权能力：授权形态只由显式字段决定', async () => {
    // unknown 年龄段 + guardian_declared 自报：数据库没有任何机制据此放行
    // self 授权，guardian 结构约束照常生效（fail closed 语义由应用层 V14 执行）。
    const subject = await seedUser();
    const guardian = await seedUser();
    const expiresAt = new Date(Date.now() + 90 * DAY_MS);

    await expect(
      seedConsent({
        subjectUserId: subject,
        grantorUserId: subject,
        authorizationType: 'guardian',
        expiresAt,
      }),
    ).rejects.toThrow();
    const consent = await seedConsent({
      subjectUserId: subject,
      grantorUserId: guardian,
      authorizationType: 'guardian',
      expiresAt,
    });
    expect(consent.authorizationType).toBe('guardian');
    expect(consent.grantorUserId).not.toBe(consent.subjectUserId);
  });

  it('同意期限默认且最多十二个月', async () => {
    const subject = await seedUser();
    const grantedAt = new Date('2026-01-01T00:00:00.000Z');
    const boundary = await seedConsent({
      subjectUserId: subject,
      purpose: 'voice_processing',
      grantedAt,
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(boundary.expiresAt.toISOString()).toBe('2027-01-01T00:00:00.000Z');

    await expect(
      seedConsent({
        subjectUserId: subject,
        purpose: 'audio_retention',
        grantedAt,
        expiresAt: new Date('2027-01-01T00:00:00.001Z'),
      }),
    ).rejects.toThrow();

    const defaultSubject = await seedUser();
    const [defaulted] = await getDb()
      .insert(audioConsents)
      .values({
        subjectUserId: defaultSubject,
        grantorUserId: defaultSubject,
        authorizationType: 'self',
        proofMethod: 'adult_self_attested',
        proofReference: `assertion:${randomUUID()}`,
        purpose: 'audio_retention',
        consentVersion: 'v1',
        noticeVersion: 'notice-1',
      })
      .returning();
    expect(defaulted).toBeDefined();
    expect(defaulted!.expiresAt.getTime()).toBeGreaterThan(
      defaulted!.grantedAt.getTime(),
    );
  });

  it('revoked consent 不能创建留存记录', async () => {
    const subject = await seedUser();
    const { versionId } = await seedAssetVersion();
    const consent = await seedConsent({
      subjectUserId: subject,
      expiresAt: new Date(Date.now() + 90 * DAY_MS),
    });
    await getDb()
      .update(audioConsents)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(audioConsents.id, consent.id));

    await expectServerViolation(
      seedRetention({
        subjectUserId: subject,
        consentId: consent.id,
        assetVersionId: versionId,
      }),
      /active consent valid at creation/i,
    );
  });

  it('撤回与留存创建并发时由 consent 行锁串行化并 fail closed', async () => {
    const subject = await seedUser();
    const { versionId } = await seedAssetVersion();
    const consent = await seedConsent({
      subjectUserId: subject,
      expiresAt: new Date(Date.now() + 90 * DAY_MS),
    });

    let notifyLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      notifyLocked = resolve;
    });
    const revoke = getDb().transaction(async (transaction) => {
      await transaction
        .update(audioConsents)
        .set({ status: 'revoked', revokedAt: new Date() })
        .where(eq(audioConsents.id, consent.id));
      notifyLocked();
      await transaction.execute(sql`select pg_sleep(0.1)`);
    });

    await locked;
    const retention = seedRetention({
      subjectUserId: subject,
      consentId: consent.id,
      assetVersionId: versionId,
    });
    void retention.catch(() => undefined);
    await revoke;
    await expectServerViolation(retention, /active consent valid at creation/i);
  });

  it('创建时已过期的 consent 不能创建留存记录', async () => {
    const subject = await seedUser();
    const { versionId } = await seedAssetVersion();
    const consent = await seedConsent({
      subjectUserId: subject,
      grantedAt: new Date(Date.now() - 2 * DAY_MS),
      expiresAt: new Date(Date.now() - DAY_MS),
    });
    await expectServerViolation(
      seedRetention({
        subjectUserId: subject,
        consentId: consent.id,
        assetVersionId: versionId,
      }),
      /valid at creation|expired/i,
    );
  });

  it('留存记录强制 purpose 为 audio_retention 且 subject 与 consent 一致', async () => {
    const subject = await seedUser();
    const { versionId } = await seedAssetVersion();
    const voiceConsent = await seedConsent({
      subjectUserId: subject,
      purpose: 'voice_processing',
      expiresAt: new Date(Date.now() + 90 * DAY_MS),
    });
    const retentionConsent = await seedConsent({
      subjectUserId: subject,
      expiresAt: new Date(Date.now() + 90 * DAY_MS),
    });

    // consentPurpose 非 audio_retention：check 拒绝。
    await expect(
      seedRetention({
        subjectUserId: subject,
        consentId: retentionConsent.id,
        assetVersionId: versionId,
        consentPurpose: 'voice_processing',
      }),
    ).rejects.toThrow();
    // 引用的 consent 行 purpose 非 audio_retention：composite FK 拒绝。
    await expect(
      seedRetention({
        subjectUserId: subject,
        consentId: voiceConsent.id,
        assetVersionId: versionId,
      }),
    ).rejects.toThrow();
    // subject 与 consent 的 subject 不一致：composite FK 拒绝。
    const otherSubject = await seedUser();
    await expect(
      seedRetention({
        subjectUserId: otherSubject,
        consentId: retentionConsent.id,
        assetVersionId: versionId,
      }),
    ).rejects.toThrow();
  });

  it('retention 引用不存在的 assetVersion 被外键拒绝', async () => {
    const subject = await seedUser();
    const consent = await seedConsent({
      subjectUserId: subject,
      expiresAt: new Date(Date.now() + 90 * DAY_MS),
    });
    await expect(
      seedRetention({
        subjectUserId: subject,
        consentId: consent.id,
        assetVersionId: randomUUID(),
      }),
    ).rejects.toThrow();
  });

  it('七天留存上限：恰好七天通过，超一毫秒失败', async () => {
    const subject = await seedUser();
    const { versionId } = await seedAssetVersion();
    const consent = await seedConsent({
      subjectUserId: subject,
      expiresAt: new Date(Date.now() + 90 * DAY_MS),
    });

    // 边界用相对时间表达（固定日期会随时间推移变成"已过期 active 行"，
    // 污染共享 DB 上其他全表扫描类断言，如 audio-retention 22+24 scanned=1）。
    // createdAt 恰好 7 天前、expiresAt 为同一时刻 → 差精确 7 天（单次 Date.now()
    // 避免两次调用引入毫秒漂移触发超限）。
    // 该行落库瞬间即已到期（createdAt 已过 7 天），且 audio_retentions 不可删除、
    // 状态只允许 active → deletion_requested——因此在同一事务内立即消费为
    // deletion_requested：未提交行对其他并行测试文件不可见，零竞态窗口。
    const now = Date.now();
    await getDb().transaction(async (transaction) => {
      const boundary = await transaction
        .insert(audioRetentions)
        .values({
          subjectUserId: subject,
          consentId: consent.id,
          consentPurpose: 'audio_retention',
          assetVersionId: versionId,
          createdAt: new Date(now - 7 * DAY_MS),
          expiresAt: new Date(now),
        })
        .returning();
      expect(boundary[0]?.expiresAt).toBeDefined();
      await transaction
        .update(audioRetentions)
        .set({ status: 'deletion_requested', deletionRequestedAt: new Date(now) })
        .where(eq(audioRetentions.id, boundary[0]!.id));
    });

    const overLimit = new Date(now + 1);
    await expect(
      seedRetention({
        subjectUserId: subject,
        consentId: consent.id,
        assetVersionId: versionId,
        createdAt: new Date(now - 7 * DAY_MS),
        expiresAt: overLimit,
      }),
    ).rejects.toThrow();
  });

  it('同一 assetVersion 不得重复留存', async () => {
    const subject = await seedUser();
    const { versionId } = await seedAssetVersion();
    const consent = await seedConsent({
      subjectUserId: subject,
      expiresAt: new Date(Date.now() + 90 * DAY_MS),
    });
    await seedRetention({
      subjectUserId: subject,
      consentId: consent.id,
      assetVersionId: versionId,
    });
    await expect(
      seedRetention({
        subjectUserId: subject,
        consentId: consent.id,
        assetVersionId: versionId,
      }),
    ).rejects.toThrow();
  });

  it('审计事实与对象引用均禁止级联或直接物理删除', async () => {
    const subject = await seedUser();
    const grantor = await seedUser();
    const { versionId } = await seedAssetVersion();
    const consent = await seedConsent({
      subjectUserId: subject,
      grantorUserId: grantor,
      authorizationType: 'guardian',
      expiresAt: new Date(Date.now() + 90 * DAY_MS),
    });
    await seedRetention({
      subjectUserId: subject,
      consentId: consent.id,
      assetVersionId: versionId,
    });

    await expectServerViolation(
      getDb().delete(audioConsents).where(eq(audioConsents.id, consent.id)),
      /immutable audit fact/i,
    );
    await expectServerViolation(
      getDb()
        .delete(audioRetentions)
        .where(eq(audioRetentions.consentId, consent.id)),
      /immutable audit fact/i,
    );

    // grantor/subject 用户均受 restrict 保护，不能让审计链静默消失。
    await expect(
      getDb().delete(platformUsers).where(eq(platformUsers.id, grantor)),
    ).rejects.toThrow();
    await expect(
      getDb().delete(platformUsers).where(eq(platformUsers.id, subject)),
    ).rejects.toThrow();
    await expect(
      getDb().delete(assetVersions).where(eq(assetVersions.id, versionId)),
    ).rejects.toThrow();
  });

  it('同意和留存的身份、依据与期限写入后不可变', async () => {
    const subject = await seedUser();
    const { versionId } = await seedAssetVersion();
    const consent = await seedConsent({
      subjectUserId: subject,
      expiresAt: new Date(Date.now() + 90 * DAY_MS),
    });
    const [retention] = await seedRetention({
      subjectUserId: subject,
      consentId: consent.id,
      assetVersionId: versionId,
    });

    await expectServerViolation(
      getDb()
        .update(audioConsents)
        .set({ proofReference: `changed:${randomUUID()}` })
        .where(eq(audioConsents.id, consent.id)),
      /immutable identity fields/i,
    );
    await expectServerViolation(
      getDb()
        .update(audioRetentions)
        .set({ expiresAt: new Date(Date.now() + DAY_MS) })
        .where(eq(audioRetentions.id, retention!.id)),
      /immutable identity fields/i,
    );

    // 生命周期字段仍允许受控转换，供 V14 原子撤回+Outbox 使用。
    await getDb()
      .update(audioRetentions)
      .set({ status: 'deletion_requested', deletionRequestedAt: new Date() })
      .where(eq(audioRetentions.id, retention!.id));
    await expectServerViolation(
      getDb()
        .update(audioRetentions)
        .set({ status: 'active', deletionRequestedAt: null })
        .where(eq(audioRetentions.id, retention!.id)),
      /terminal lifecycle/i,
    );
  });

  it('撤回 consent 后同主体同目的允许重新征求，但 active 期间保持唯一', async () => {
    const subject = await seedUser();
    const expiresAt = new Date(Date.now() + 90 * DAY_MS);
    const first = await seedConsent({ subjectUserId: subject, expiresAt });
    await expect(
      seedConsent({ subjectUserId: subject, expiresAt }),
    ).rejects.toThrow();
    await getDb()
      .update(audioConsents)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(audioConsents.id, first.id));
    await expectServerViolation(
      getDb()
        .update(audioConsents)
        .set({ status: 'active', revokedAt: null })
        .where(eq(audioConsents.id, first.id)),
      /terminal lifecycle/i,
    );
    await seedConsent({ subjectUserId: subject, expiresAt });
  });
});
