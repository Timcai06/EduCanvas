import { and, eq, ne } from 'drizzle-orm';
import { getDb } from './client';
import { requireNotebookAccess } from './notebook-access';
import { assetVersions, assetWebSnapshots, assets } from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

export interface CreateAssetWebSnapshotInput {
  requestedUrl: string;
  finalUrl: string;
  responseContentType: string;
  pageTitle?: string | null;
  fetchedAt: Date;
}

export interface AssetWebSnapshot {
  assetVersionId: string;
  requestedUrl: string;
  finalUrl: string;
  responseContentType: string;
  pageTitle: string | null;
  fetchedAt: string;
}

type PersistenceErrorFactory = (message: string) => Error;

function requireText(
  value: string,
  label: string,
  max: number,
  error: PersistenceErrorFactory,
): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw error(`${label}无效`);
  return normalized;
}

function requireWebUrl(value: string, error: PersistenceErrorFactory): string {
  const normalized = requireText(value, 'url', 2_048, error);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw error('网页URL无效');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    !parsed.hostname
  ) {
    throw error('网页URL无效');
  }
  parsed.hash = '';
  return parsed.toString();
}

export async function insertAssetWebSnapshot(
  database: DatabaseExecutor,
  input: CreateAssetWebSnapshotInput & {
    assetVersionId: string;
    createdAt: Date;
  },
  error: PersistenceErrorFactory,
): Promise<void> {
  await database.insert(assetWebSnapshots).values({
    assetVersionId: input.assetVersionId,
    requestedUrl: requireWebUrl(input.requestedUrl, error),
    finalUrl: requireWebUrl(input.finalUrl, error),
    responseContentType: requireText(
      input.responseContentType,
      'responseContentType',
      255,
      error,
    ).toLowerCase(),
    pageTitle: input.pageTitle
      ? requireText(input.pageTitle, 'pageTitle', 300, error)
      : null,
    fetchedAt: input.fetchedAt,
    createdAt: input.createdAt,
  });
}

/** Reads only browser-safe provenance after rechecking notebook membership. */
export async function readOwnedAssetWebSnapshot(
  database: Database,
  input: {
    ownerSubjectId: string;
    spaceId: string;
    assetId: string;
    now: Date;
  },
  accessError: () => Error,
): Promise<AssetWebSnapshot | null> {
  await requireNotebookAccess(database, {
    notebookId: input.spaceId,
    trustedSubjectId: input.ownerSubjectId,
    requiredPermission: 'notebook.read',
    now: input.now,
  }).catch(() => {
    throw accessError();
  });
  const [row] = await database
    .select({ snapshot: assetWebSnapshots })
    .from(assets)
    .innerJoin(assetVersions, eq(assetVersions.id, assets.currentVersionId))
    .innerJoin(
      assetWebSnapshots,
      eq(assetWebSnapshots.assetVersionId, assetVersions.id),
    )
    .where(
      and(
        eq(assets.id, input.assetId),
        eq(assets.spaceId, input.spaceId),
        ne(assets.status, 'tombstoned'),
      ),
    )
    .limit(1);
  return row
    ? {
        assetVersionId: row.snapshot.assetVersionId,
        requestedUrl: row.snapshot.requestedUrl,
        finalUrl: row.snapshot.finalUrl,
        responseContentType: row.snapshot.responseContentType,
        pageTitle: row.snapshot.pageTitle,
        fetchedAt: row.snapshot.fetchedAt.toISOString(),
      }
    : null;
}
