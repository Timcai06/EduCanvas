/** Shared fixtures for the V14 PostgreSQL integration suite. */
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { audioConsents, audioRetentions } from './schema/audio-consent';
import {
  assetVersions,
  assets,
  delegatedGrants,
  notebookMemberships,
  objectDeletionOutbox,
  platformUsers,
  securityAuditEvents,
  spaces,
} from './schema';
import * as schema from './schema';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error('集成测试数据库名必须以_integration或_test结尾');
  }
  return value;
}

export const testDatabaseUrl = resolveTestDatabaseUrl();
export const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 2 })
  : null;
const db = connection ? drizzle(connection, { schema }) : null;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function getDb() {
  if (!db) throw new Error('TEST_DATABASE_URL未设置');
  return db;
}

export async function seedUser(id = `user-${randomUUID()}`) {
  await getDb()
    .insert(platformUsers)
    .values({ id, kind: 'registered', status: 'active' });
  return id;
}

export async function seedAssetVersion(ownerSubjectId: string) {
  const [space] = await getDb()
    .insert(spaces)
    .values({
      ownerSubjectId,
      kind: 'personal',
      title: '测试空间',
      status: 'active',
    })
    .returning();
  const [asset] = await getDb()
    .insert(assets)
    .values({
      ownerSubjectId,
      spaceId: space!.id,
      scope: 'turn',
      kind: 'audio',
      origin: 'upload',
      displayName: '测试音频',
      status: 'pending',
    })
    .returning();
  const storageKey = `audio-key-${randomUUID()}`;
  const [version] = await getDb()
    .insert(assetVersions)
    .values({
      assetId: asset!.id,
      kind: 'audio',
      mimeType: 'audio/wav',
      byteSize: 1024,
      contentHash: 'a'.repeat(64),
      status: 'ready',
      storageKey,
    })
    .returning();
  return { versionId: version!.id, storageKey };
}

export async function seedConsent(input: {
  subjectUserId: string;
  grantorUserId?: string;
  authorizationType?: 'self' | 'guardian';
  proofMethod?: string;
  purpose?: string;
  grantedAt?: Date;
  expiresAt?: Date;
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
      proofReference: `assertion:${randomUUID()}`,
      purpose: input.purpose ?? 'audio_retention',
      consentVersion: 'v1',
      noticeVersion: 'notice-1',
      grantedAt: input.grantedAt,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 90 * DAY_MS),
    })
    .returning();
  if (!row) throw new Error('seed consent failed');
  return row;
}

export async function seedRetention(input: {
  subjectUserId: string;
  consentId: string;
  assetVersionId: string;
  createdAt?: Date;
  expiresAt?: Date;
}) {
  const createdAt = input.createdAt ?? new Date();
  const [row] = await getDb()
    .insert(audioRetentions)
    .values({
      subjectUserId: input.subjectUserId,
      consentId: input.consentId,
      consentPurpose: 'audio_retention',
      assetVersionId: input.assetVersionId,
      createdAt,
      expiresAt: input.expiresAt ?? new Date(createdAt.getTime() + 3 * DAY_MS),
    })
    .returning();
  if (!row) throw new Error('seed retention failed');
  return row;
}

export async function seedDelegatedGrant(
  kind: string,
  grantee: string,
  subject: string,
  grantedBy: string,
) {
  await getDb()
    .insert(delegatedGrants)
    .values({
      kind,
      granteeUserId: grantee,
      subjectUserId: subject,
      scopes: ['operation.audit'],
      grantedByUserId: grantedBy,
      expiresAt: new Date(Date.now() + 90 * DAY_MS),
    });
}

export async function seedNotebookMember(
  userId: string,
  role: 'owner' | 'editor' | 'viewer',
  grantedBy: string,
) {
  const [space] = await getDb()
    .insert(spaces)
    .values({
      ownerSubjectId: grantedBy,
      kind: 'notebook',
      title: '测试笔记本',
      status: 'active',
    })
    .returning();
  await getDb().insert(notebookMemberships).values({
    notebookId: space!.id,
    userId,
    role,
    grantedByUserId: grantedBy,
  });
}

export function auditEventsFor(resourceId: string) {
  return getDb()
    .select()
    .from(securityAuditEvents)
    .where(eq(securityAuditEvents.resourceId, resourceId))
    .orderBy(asc(securityAuditEvents.occurredAt), asc(securityAuditEvents.id));
}

export async function consentRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(audioConsents)
    .where(eq(audioConsents.id, id));
  return row;
}

export function outboxRows(sourceId: string) {
  return getDb()
    .select()
    .from(objectDeletionOutbox)
    .where(eq(objectDeletionOutbox.sourceId, sourceId));
}

export async function retentionRowOf(consentId: string) {
  const [row] = await getDb()
    .select()
    .from(audioRetentions)
    .where(eq(audioRetentions.consentId, consentId));
  return row;
}

/** Remove only deletion intents produced from audio retention fixtures. */
export async function cleanupRetentionDeletionOutbox() {
  await connection!`
    delete from object_deletion_outbox outbox
    using audio_retentions retention
    where outbox.source_type = 'asset_version'
      and outbox.source_id = retention.asset_version_id
  `;
}
