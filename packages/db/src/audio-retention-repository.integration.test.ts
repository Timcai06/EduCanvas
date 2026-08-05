import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AudioRetentionAccessError,
  AudioRetentionConsentError,
  AudioRetentionPeriodError,
  AudioRetentionPersistenceError,
  AudioRetentionRepository,
  AUDIO_RETENTION_READ_EVENT_TYPE,
  AUDIO_RETENTION_RESOURCE_TYPE,
} from './index';
import { audioConsents, audioRetentions } from './schema/audio-consent';
import {
  DAY_MS,
  auditEventsFor,
  cleanupRetentionDeletionOutbox,
  connection,
  consentRow,
  getDb,
  outboxRows,
  retentionRowOf,
  seedAssetVersion,
  seedConsent,
  seedDelegatedGrant,
  seedNotebookMember,
  seedRetention,
  seedUser,
  testDatabaseUrl,
} from './audio-retention-repository.integration-support';
import { objectDeletionOutbox } from './schema';
import * as schema from './schema';

const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase('音频留存 Repository（V14）', () => {
  let repo: AudioRetentionRepository;
  let devRepo: AudioRetentionRepository;
  /** 以本人 self 同意创建一条 active 留存（it 内调用，beforeAll 后 repo 已就绪）。 */
  async function seedReadyRetention() {
    const subject = await seedUser();
    const consent = await seedConsent({ subjectUserId: subject });
    const { versionId, storageKey } = await seedAssetVersion(subject);
    const created = await repo.createRetention({
      consentId: consent.id,
      subjectUserId: subject,
      assetVersionId: versionId,
    });
    return { subject, consent, versionId, storageKey, created };
  }
  /** guardian 同意创建留存，返回 child/guardian/consent/created。 */
  async function seedGuardianRetention(proofMethod: string) {
    const child = await seedUser();
    const guardian = await seedUser();
    const consent = await seedConsent({
      subjectUserId: child,
      grantorUserId: guardian,
      authorizationType: 'guardian',
      proofMethod,
    });
    const { versionId } = await seedAssetVersion(child);
    const created = await repo.createRetention({
      consentId: consent.id,
      subjectUserId: child,
      assetVersionId: versionId,
    });
    return { child, guardian, consent, created };
  }

  beforeAll(async () => {
    if (!connection) throw new Error('TEST_DATABASE_URL未设置');
    await migrate(drizzle(connection, { schema: {} as never }), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await cleanupRetentionDeletionOutbox();
    repo = new AudioRetentionRepository({ database: getDb() });
    devRepo = new AudioRetentionRepository({
      database: getDb(),
      guardianProofPolicy: 'allow_self_attested',
    });
  });

  afterAll(async () => {
    await cleanupRetentionDeletionOutbox();
    await connection?.end({ timeout: 5 });
  });

  it('1. 有效本人同意创建留存', async () => {
    const {
      consent,
      subject,
      versionId,
      created: summary,
    } = await seedReadyRetention();
    expect(summary.retentionId).toBeDefined();
    expect(summary).toMatchObject({
      consentId: consent.id,
      subjectUserId: subject,
      assetVersionId: versionId,
      status: 'active',
    });
  });

  const createRejectedCases: Array<
    [string, (subject: string) => Promise<string>]
  > = [
    ['2. 无 consent 拒绝', async () => randomUUID()],
    [
      '3. consent purpose 错误拒绝',
      async (subject) =>
        (
          await seedConsent({
            subjectUserId: subject,
            purpose: 'voice_processing',
          })
        ).id,
    ],
    [
      '4. consent 已撤回拒绝',
      async (subject) => {
        const consent = await seedConsent({ subjectUserId: subject });
        await getDb()
          .update(audioConsents)
          .set({ status: 'revoked', revokedAt: sql`now()` })
          .where(eq(audioConsents.id, consent.id));
        return consent.id;
      },
    ],
    [
      '5. consent 已过期拒绝',
      async (subject) =>
        (
          await seedConsent({
            subjectUserId: subject,
            grantedAt: new Date(Date.now() - 2 * DAY_MS),
            expiresAt: new Date(Date.now() - DAY_MS),
          })
        ).id,
    ],
  ];
  for (const [name, consentOf] of createRejectedCases) {
    it(name, async () => {
      const subject = await seedUser();
      const { versionId } = await seedAssetVersion(subject);
      await expect(
        repo.createRetention({
          consentId: await consentOf(subject),
          subjectUserId: subject,
          assetVersionId: versionId,
        }),
      ).rejects.toBeInstanceOf(AudioRetentionConsentError);
    });
  }

  it('6. 留存超过 7 天拒绝，恰好 7 天通过', async () => {
    const { consent, subject } = await seedReadyRetention();
    const inTime = new Date(Date.now() + 7 * DAY_MS - 60_000);
    const { versionId: second } = await seedAssetVersion(subject);
    const ok = await repo.createRetention({
      consentId: consent.id,
      subjectUserId: subject,
      assetVersionId: second,
      expiresAt: inTime,
    });
    expect(ok.expiresAt).toBe(inTime.toISOString());
    const { versionId: third } = await seedAssetVersion(subject);
    await expect(
      repo.createRetention({
        consentId: consent.id,
        subjectUserId: subject,
        assetVersionId: third,
        expiresAt: new Date(Date.now() + 7 * DAY_MS + 60_000),
      }),
    ).rejects.toBeInstanceOf(AudioRetentionPeriodError);
  });

  it('7. 同一 assetVersion 重复创建幂等返回既有行', async () => {
    const {
      subject,
      consent,
      versionId,
      created: first,
    } = await seedReadyRetention();
    const second = await repo.createRetention({
      consentId: consent.id,
      subjectUserId: subject,
      assetVersionId: versionId,
    });
    expect(second.retentionId).toBe(first.retentionId);
    const rows = await getDb()
      .select({ id: audioRetentions.id })
      .from(audioRetentions)
      .where(eq(audioRetentions.assetVersionId, versionId));
    expect(rows).toHaveLength(1);
  });

  it('7a. 跨主体 assetVersion 不能绑定到留存或进入删除链路', async () => {
    const owner = await seedUser();
    const attacker = await seedUser();
    const consent = await seedConsent({ subjectUserId: attacker });
    const { versionId } = await seedAssetVersion(owner);
    await expect(
      repo.createRetention({
        consentId: consent.id,
        subjectUserId: attacker,
        assetVersionId: versionId,
      }),
    ).rejects.toBeInstanceOf(AudioRetentionAccessError);
    expect(
      await getDb()
        .select()
        .from(audioRetentions)
        .where(eq(audioRetentions.assetVersionId, versionId)),
    ).toHaveLength(0);
    expect(await outboxRows(versionId)).toHaveLength(0);
  });

  it('7b. 相同版本但不同 consent 不能回显既有留存摘要', async () => {
    const { subject, consent, versionId } = await seedReadyRetention();
    await repo.revokeConsent({
      consentId: consent.id,
      requesterUserId: subject,
    });
    const replacement = await seedConsent({ subjectUserId: subject });
    await expect(
      repo.createRetention({
        consentId: replacement.id,
        subjectUserId: subject,
        assetVersionId: versionId,
      }),
    ).rejects.toBeInstanceOf(AudioRetentionAccessError);
  });

  it('8+16. 本人读取成功并写完整 succeeded 审计', async () => {
    const { subject, created } = await seedReadyRetention();
    const summary = await repo.readRetention({
      retentionId: created.retentionId,
      requesterUserId: subject,
    });
    expect(summary.retentionId).toBe(created.retentionId);
    const read = (await auditEventsFor(created.retentionId)).find(
      (event) => event.eventType === AUDIO_RETENTION_READ_EVENT_TYPE,
    )!;
    expect(read).toMatchObject({
      eventType: AUDIO_RETENTION_READ_EVENT_TYPE,
      resourceType: AUDIO_RETENTION_RESOURCE_TYPE,
      resourceId: created.retentionId,
      outcome: 'succeeded',
      actorUserId: subject,
      reasonCode: 'audio_retention_read_succeeded',
      metadata: { access_role: 'subject' },
    });
  });

  it('9. verified guardian 读取成功', async () => {
    const { child, guardian, created } =
      await seedGuardianRetention('guardian_verified');
    const summary = await repo.readRetention({
      retentionId: created.retentionId,
      requesterUserId: guardian,
    });
    expect(summary.retentionId).toBe(created.retentionId);
    expect(summary.subjectUserId).toBe(child);
    const audits = await auditEventsFor(created.retentionId);
    expect(audits[0]!.outcome).toBe('succeeded');
    expect(audits[0]!.metadata).toMatchObject({
      access_role: 'verified_guardian',
      proof_method: 'guardian_verified',
    });
  });

  it('10+11. self_attested guardian：生产拒绝、显式开发策略允许', async () => {
    const { guardian, created } = await seedGuardianRetention(
      'guardian_self_attested',
    );
    await expect(
      repo.readRetention({
        retentionId: created.retentionId,
        requesterUserId: guardian,
      }),
    ).rejects.toBeInstanceOf(AudioRetentionAccessError);
    const audits = await auditEventsFor(created.retentionId);
    expect(audits[0]!.outcome).toBe('denied');
    expect(audits[0]!.reasonCode).toBe(
      'audio_retention_guardian_proof_not_verified',
    );
    const summary = await devRepo.readRetention({
      retentionId: created.retentionId,
      requesterUserId: guardian,
    });
    expect(summary.retentionId).toBe(created.retentionId);
  });

  it('12-14. 教师/管理员/Notebook 成员不能自动获得读取权', async () => {
    const child = await seedUser();
    const admin = await seedUser();
    const teacher = await seedUser();
    const operator = await seedUser();
    const owner = await seedUser();
    const editor = await seedUser();
    const viewer = await seedUser();
    await seedDelegatedGrant('education.teacher', teacher, child, admin);
    await seedDelegatedGrant('platform.operator', operator, child, admin);
    await seedNotebookMember(owner, 'owner', child);
    await seedNotebookMember(editor, 'editor', child);
    await seedNotebookMember(viewer, 'viewer', child);
    const consent = await seedConsent({
      subjectUserId: child,
      grantorUserId: admin,
      authorizationType: 'guardian',
      proofMethod: 'guardian_verified',
    });
    const { versionId } = await seedAssetVersion(child);
    const created = await repo.createRetention({
      consentId: consent.id,
      subjectUserId: child,
      assetVersionId: versionId,
    });
    for (const user of [teacher, operator, owner, editor, viewer]) {
      await expect(
        repo.readRetention({
          retentionId: created.retentionId,
          requesterUserId: user,
        }),
      ).rejects.toBeInstanceOf(AudioRetentionAccessError);
    }
  });

  it('15. 跨主体与不存在统一稳定错误', async () => {
    const { subject, created } = await seedReadyRetention();
    const other = await seedUser();
    const crossSubject = repo.readRetention({
      retentionId: created.retentionId,
      requesterUserId: other,
    });
    const notFound = repo.readRetention({
      retentionId: randomUUID(),
      requesterUserId: subject,
    });
    await expect(crossSubject).rejects.toMatchObject({
      code: 'audio_retention_access_denied',
    });
    await expect(notFound).rejects.toMatchObject({
      code: 'audio_retention_access_denied',
    });
  });

  it('17. 拒绝读取写 denied 审计', async () => {
    const other = await seedUser();
    const { subject, created } = await seedReadyRetention();
    await expect(
      repo.readRetention({
        retentionId: created.retentionId,
        requesterUserId: other,
      }),
    ).rejects.toBeInstanceOf(AudioRetentionAccessError);
    const denied = (await auditEventsFor(created.retentionId)).find(
      (event) => event.eventType === AUDIO_RETENTION_READ_EVENT_TYPE,
    )!;
    expect(denied).toMatchObject({
      outcome: 'denied',
      reasonCode: 'audio_retention_access_denied',
      actorUserId: other,
    });
  });

  it('18. 审计内容不含 storageKey/proofReference', async () => {
    const { subject, storageKey, created } = await seedReadyRetention();
    await repo.readRetention({
      retentionId: created.retentionId,
      requesterUserId: subject,
    });
    const audits = await auditEventsFor(created.retentionId);
    const read = audits[0]!;
    expect(read.metadata).not.toHaveProperty('storage_key');
    expect(read.metadata).not.toHaveProperty('proof_reference');
    expect(JSON.stringify(audits)).not.toContain(storageKey);
    expect(JSON.stringify(audits)).not.toContain('assertion:');
  });

  it('19. 撤回、retention 状态和 Outbox 同一事务提交', async () => {
    const subject = await seedUser();
    const guardian = await seedUser();
    const consent = await seedConsent({
      subjectUserId: subject,
      grantorUserId: guardian,
      authorizationType: 'guardian',
      proofMethod: 'guardian_verified',
    });
    const { versionId, storageKey } = await seedAssetVersion(subject);
    await repo.createRetention({
      consentId: consent.id,
      subjectUserId: subject,
      assetVersionId: versionId,
    });
    const result = await repo.revokeConsent({
      consentId: consent.id,
      requesterUserId: guardian,
    });
    expect(result).toMatchObject({
      status: 'revoked',
      alreadyRevoked: false,
      deletionIntents: 1,
    });
    const consentAfter = await consentRow(consent.id);
    const retentionAfter = await retentionRowOf(consent.id);
    expect(consentAfter!.status).toBe('revoked');
    expect(consentAfter!.revokedAt).not.toBeNull();
    expect(retentionAfter!.status).toBe('deletion_requested');
    expect(retentionAfter!.deletionRequestedAt).not.toBeNull();
    const outbox = await outboxRows(versionId);
    expect(outbox[0]).toMatchObject({
      objectKind: 'asset',
      sourceType: 'asset_version',
      storageKey,
      status: 'pending',
    });
  });

  it('20. Outbox 写失败时撤回整体回滚', async () => {
    await connection!`create or replace function block_outbox_insert() returns trigger as $$
      begin raise exception 'test outbox insert blocked'; end;
    $$ language plpgsql`;
    await connection!`create trigger outbox_blocker before insert on object_deletion_outbox
      for each row execute function block_outbox_insert()`;
    try {
      const { subject, consent, versionId } = await seedReadyRetention();
      await expect(
        repo.revokeConsent({ consentId: consent.id, requesterUserId: subject }),
      ).rejects.toBeInstanceOf(AudioRetentionPersistenceError);
      expect((await consentRow(consent.id))!.status).toBe('active');
      expect((await retentionRowOf(consent.id))!.status).toBe('active');
      expect(await outboxRows(versionId)).toHaveLength(0);
    } finally {
      await connection!`drop trigger if exists outbox_blocker on object_deletion_outbox`;
      await connection!`drop function if exists block_outbox_insert()`;
    }
  });

  it('21. 重复撤回幂等', async () => {
    const { subject, consent, versionId } = await seedReadyRetention();
    const first = await repo.revokeConsent({
      consentId: consent.id,
      requesterUserId: subject,
    });
    const second = await repo.revokeConsent({
      consentId: consent.id,
      requesterUserId: subject,
    });
    expect(first.deletionIntents).toBe(1);
    expect(second).toMatchObject({ alreadyRevoked: true, deletionIntents: 0 });
    expect(await outboxRows(versionId)).toHaveLength(1);
  });

  it('21a. 撤回后本人也不能继续读取留存', async () => {
    const { subject, consent, created } = await seedReadyRetention();
    await repo.revokeConsent({
      consentId: consent.id,
      requesterUserId: subject,
    });
    await expect(
      repo.readRetention({
        retentionId: created.retentionId,
        requesterUserId: subject,
      }),
    ).rejects.toBeInstanceOf(AudioRetentionAccessError);
    const audits = await auditEventsFor(created.retentionId);
    expect(audits.at(-1)).toMatchObject({
      outcome: 'denied',
      reasonCode: 'audio_retention_consent_inactive',
    });
  });

  it('22+24. 到期扫描写 durable Outbox，重跑不重复创建删除意图', async () => {
    const subject = await seedUser();
    const consent = await seedConsent({ subjectUserId: subject });
    const { versionId, storageKey } = await seedAssetVersion(subject);
    const retention = await seedRetention({
      subjectUserId: subject,
      consentId: consent.id,
      assetVersionId: versionId,
      createdAt: new Date(Date.now() - 5 * 60_000),
      expiresAt: new Date(Date.now() - 60_000),
    });
    const first = await repo.scanExpiredRetentions({
      now: new Date(Date.now() + 1_000),
    });
    expect(first.scanned).toBe(1);
    const outbox = await outboxRows(versionId);
    expect(outbox[0]).toMatchObject({
      objectKind: 'asset',
      sourceType: 'asset_version',
      storageKey,
    });
    const [row] = await getDb()
      .select()
      .from(audioRetentions)
      .where(eq(audioRetentions.id, retention.id));
    expect(row!.status).toBe('deletion_requested');
    expect(row!.deletionRequestedAt).not.toBeNull();
    const second = await repo.scanExpiredRetentions({
      now: new Date(Date.now() + 1_000),
    });
    expect(second.scanned).toBe(0);
    expect(await outboxRows(versionId)).toHaveLength(1);
  });

  it('23. 两个扫描器并发只有一个领取', async () => {
    const subject = await seedUser();
    const consent = await seedConsent({ subjectUserId: subject });
    const { versionId } = await seedAssetVersion(subject);
    await seedRetention({
      subjectUserId: subject,
      consentId: consent.id,
      assetVersionId: versionId,
      createdAt: new Date(Date.now() - 5 * 60_000),
      expiresAt: new Date(Date.now() - 60_000),
    });
    const scannerOne = postgres(testDatabaseUrl!, { max: 1 });
    try {
      await scannerOne`begin`;
      const claimed = await scannerOne<{ id: string }[]>`
        select id from audio_retentions
        where status = 'active' and expires_at <= now()
        order by expires_at, id
        limit 100
        for update skip locked`;
      expect(claimed.length).toBe(1);
      const concurrent = await repo.scanExpiredRetentions({
        now: new Date(Date.now() + 1_000),
      });
      expect(concurrent.scanned).toBe(0);
      await scannerOne`commit`;
    } finally {
      await scannerOne.end({ timeout: 5 });
    }
    const afterRelease = await repo.scanExpiredRetentions({
      now: new Date(Date.now() + 1_000),
    });
    expect(afterRelease.scanned).toBe(1);
  });

  it('25. 公共 DTO 不含 storageKey', async () => {
    const { subject, created } = await seedReadyRetention();
    const read = await repo.readRetention({
      retentionId: created.retentionId,
      requesterUserId: subject,
    });
    for (const dto of [created, read]) {
      expect(Object.keys(dto)).toEqual(
        expect.arrayContaining([
          'retentionId',
          'consentId',
          'subjectUserId',
          'assetVersionId',
          'status',
          'createdAt',
          'expiresAt',
        ]),
      );
      expect(Object.keys(dto)).not.toContain('storageKey');
      expect(JSON.stringify(dto)).not.toMatch(
        /storage|proof|prompt|provider|stack/i,
      );
    }
  });

  it('26. 数据库错误、堆栈和内部路径不进入稳定错误', async () => {
    const subject = await seedUser();
    const consent = await seedConsent({ subjectUserId: subject });
    let error: unknown;
    try {
      await repo.createRetention({
        consentId: consent.id,
        subjectUserId: subject,
        assetVersionId: 'not-a-uuid',
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AudioRetentionPersistenceError);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toMatch(
      /uuid|invalid input|22P02|constraint|violat|at /i,
    );
    expect((error as { code?: string }).code).toBe(
      'audio_retention_persistence_failed',
    );
  });
});
