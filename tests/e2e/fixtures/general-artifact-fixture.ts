import { expect, type Locator, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ArtifactKind =
  'mind_map' | 'slides' | 'flashcards' | 'note' | 'audio_overview';

export type ArtifactApiKind = Exclude<ArtifactKind, 'audio_overview'>;

export interface ArtifactFixture {
  artifactId: string;
  title: string;
  conversationId: string;
}

export interface ApiArtifactResponse {
  artifact: {
    id: string;
    kind: string;
    title: string;
    status: string;
    trustTier: string;
    latestVersion: number;
  };
  job: { id: string; status: string } | null;
}

export interface AppendedVersionInput {
  content?: unknown;
  metadata?: Record<string, unknown> | null;
  objectKey?: string;
  checksum?: string;
  generatedBy?: string | null;
}

export const ACTIVE_CONVERSATION_COOKIE =
  '__Host-educanvas_active_conversation';
export const STUDIO_TRIGGER_NAME = '打开全部资源';
export const PLUS_MENU_TRIGGER_NAME = '添加来源';
export const OBJECT_STORAGE_ROOT = path.resolve(
  'output/playwright/object-storage',
);
const AUDIO_BYTES = Buffer.from([
  0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00,
]);

async function importArtifactDeps() {
  const [dbModule, testingDbModule] = await Promise.all([
    import('@educanvas/db'),
    import('@educanvas/db/testing'),
  ]);
  return {
    dbModule,
    internalDbModule: testingDbModule,
    drizzleModule: testingDbModule,
  };
}

export async function activeConversationId(page: Page): Promise<string> {
  const value = (await page.context().cookies()).find(
    (cookie) => cookie.name === ACTIVE_CONVERSATION_COOKIE,
  )?.value;
  if (!value) throw new Error('E2E 当前会话 Cookie 不存在');
  return value;
}

export async function ensureGeneralNotebook(page: Page) {
  await page.getByRole('button', { name: PLUS_MENU_TRIGGER_NAME }).click();
  await page.getByRole('menuitem', { name: '上传文件' }).click();
  await page
    .getByRole('dialog', { name: '添加文档来源' })
    .getByRole('button', { name: '关闭' })
    .click();
  await expect.poll(() => activeConversationId(page)).toBeTruthy();
}

export async function openStudioOutput(page: Page) {
  await page.getByRole('button', { name: STUDIO_TRIGGER_NAME }).click();
  const studio = page.getByRole('region', {
    name: '当前笔记本的资源控制台',
  });
  await expect(studio).toBeVisible();
  await studio.getByRole('tab', { name: /^输出/ }).click();
  await expect(studio.getByRole('list', { name: '输出列表' })).toBeVisible();
  return studio;
}

export async function closeCanvasAndWaitForFold(page: Page) {
  const folded = page.waitForResponse((response) => {
    if (
      response.request().method() !== 'PUT' ||
      !response.url().endsWith('/api/v1/canvas/surface-layout') ||
      !response.ok()
    ) {
      return false;
    }
    try {
      return response.request().postDataJSON()?.restState === 'folded';
    } catch {
      return false;
    }
  });
  await page
    .getByRole('dialog', { name: '产物Canvas' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await folded;
}

export async function openArtifactAndExpectLatest(
  page: Page,
  artifactTitle: string,
) {
  const studio = await openStudioOutput(page);
  const item = studio.getByRole('button', { name: new RegExp(artifactTitle) });
  await expect(item).toBeVisible();
  await item.click();
}

export async function createArtifactFixture(
  page: Page,
  kind: ArtifactKind,
  title: string,
): Promise<ArtifactFixture> {
  const conversationId = await activeConversationId(page);
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
  const { dbModule, internalDbModule, drizzleModule } =
    await importArtifactDeps();
  const { DrizzlePlatformArtifactRepository, conversations } = dbModule;
  const { getDb } = internalDbModule;
  const { eq } = drizzleModule;
  const [conversation] = await getDb()
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new Error('E2E 当前会话行不存在');

  const repository = new DrizzlePlatformArtifactRepository();
  const created = await repository.createArtifact({
    spaceId: conversation.spaceId,
    trustedSubjectId: conversation.ownerSubjectId,
    conversationId,
    kind,
    trustTier: kind === 'audio_overview' ? 'tier2' : 'tier1',
    title,
  });
  return {
    artifactId: created.id,
    title,
    conversationId,
  };
}

export async function appendVersions(
  page: Page,
  artifactId: string,
  versions: AppendedVersionInput[],
) {
  const conversationId = await activeConversationId(page);
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
  const { dbModule, internalDbModule, drizzleModule } =
    await importArtifactDeps();
  const [conversation] = await internalDbModule
    .getDb()
    .select()
    .from(dbModule.conversations)
    .where(drizzleModule.eq(dbModule.conversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new Error('E2E 当前会话行不存在');

  const repository = new dbModule.DrizzlePlatformArtifactRepository();
  for (const version of versions) {
    await repository.appendVersion({
      artifactId,
      trustedSubjectId: conversation.ownerSubjectId,
      content: version.content,
      metadata: version.metadata,
      objectKey: version.objectKey,
      checksum: version.checksum,
      generatedBy: version.generatedBy,
    });
  }
}

export async function createMindMapArtifactFixture(
  page: Page,
  title: string,
): Promise<ArtifactFixture> {
  const conversationId = await activeConversationId(page);
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
  const { dbModule, internalDbModule, drizzleModule } =
    await importArtifactDeps();
  const [conversation] = await internalDbModule
    .getDb()
    .select()
    .from(dbModule.conversations)
    .where(drizzleModule.eq(dbModule.conversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new Error('E2E 当前会话行不存在');

  const artifacts = new dbModule.DrizzlePlatformArtifactRepository();
  const artifact = await artifacts.createArtifact({
    spaceId: conversation.spaceId,
    conversationId,
    trustedSubjectId: conversation.ownerSubjectId,
    kind: 'mind_map',
    trustTier: 'tier1',
    title,
  });
  await artifacts.appendVersion({
    artifactId: artifact.id,
    trustedSubjectId: conversation.ownerSubjectId,
    generatedBy: `e2e:${randomUUID()}:mindmap`,
    content: {
      contentVersion: 2,
      rootNodeId: 'root-node',
      nodes: [{ id: 'root-node', label: title }],
      edges: [],
    },
  });
  return {
    artifactId: artifact.id,
    conversationId,
    title,
  };
}

export async function createArtifactViaApi(
  page: Page,
  kind: ArtifactApiKind,
  title: string,
): Promise<ArtifactFixture & { jobId: string; jobStatus: string }> {
  const response = await page.evaluate(
    async (input) => {
      const response = await fetch('/api/v1/chat/artifacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: input.kind,
          title: input.title,
        }),
      });
      const bodyText = await response.text();
      return {
        status: response.status,
        body: bodyText ? JSON.parse(bodyText) : null,
      };
    },
    { kind, title },
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`E2E API 创建产物失败: ${response.status}`);
  }
  const body = response.body as ApiArtifactResponse | null;
  if (!body?.artifact?.id || !body.job?.id) {
    throw new Error('E2E API 产物返回缺少 artifact.id 或 job.id');
  }

  const conversationId = await activeConversationId(page);
  return {
    artifactId: body.artifact.id,
    title,
    conversationId,
    jobId: body.job.id,
    jobStatus: body.job.status,
  };
}

export async function openMindMapCanvasByDbFixture(page: Page) {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '今天想学什么？' }),
  ).toBeVisible();

  await ensureGeneralNotebook(page);
  const fixture = await createMindMapArtifactFixture(page, '对话思维导图');
  const studio = await openStudioOutput(page);
  const item = studio.getByRole('button', { name: fixture.title });
  await expect(item).toBeVisible({ timeout: 30_000 });
  await item.click();

  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible();
  return { fixture, canvas };
}

export async function waitForGenerationJobSucceeded(
  page: Page,
  jobId: string,
  timeoutMs = 60_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const conversationId = await activeConversationId(page);
        const { dbModule, internalDbModule, drizzleModule } =
          await importArtifactDeps();
        process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
        const [conversation] = await internalDbModule
          .getDb()
          .select({ ownerSubjectId: dbModule.conversations.ownerSubjectId })
          .from(dbModule.conversations)
          .where(drizzleModule.eq(dbModule.conversations.id, conversationId))
          .limit(1);
        if (!conversation) return null;
        const repository = new dbModule.DrizzlePlatformArtifactRepository();
        const job = await repository.getGenerationJob({
          jobId,
          trustedSubjectId: conversation.ownerSubjectId,
        });
        return job.status;
      },
      { timeout: timeoutMs, intervals: [200, 300, 500, 1000] },
    )
    .toBe('succeeded');
}

export async function createAudioOverviewFixture(
  page: Page,
): Promise<ArtifactFixture> {
  const conversationId = await activeConversationId(page);
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
  const { dbModule, internalDbModule, drizzleModule } =
    await importArtifactDeps();
  const [conversation] = await internalDbModule
    .getDb()
    .select()
    .from(dbModule.conversations)
    .where(drizzleModule.eq(dbModule.conversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new Error('E2E 当前会话行不存在');

  const sourceBytes = await readFile(
    path.resolve('tests/fixtures/sample-1page.pdf'),
  );
  const storageKey = `e2e/${conversation.id}/audio-source.pdf`;
  const storedPath = path.join(OBJECT_STORAGE_ROOT, storageKey);
  await mkdir(path.dirname(storedPath), { recursive: true });
  await writeFile(storedPath, sourceBytes);
  await new dbModule.DrizzleAssetRepository().createUploaded({
    ownerSubjectId: conversation.ownerSubjectId,
    spaceId: conversation.spaceId,
    scope: 'space',
    kind: 'document',
    displayName: '音频来源讲义.pdf',
    mimeType: 'application/pdf',
    byteSize: sourceBytes.byteLength,
    contentHash: createHash('sha256').update(sourceBytes).digest('hex'),
    storageKey,
    extractedText: '神经网络由多层神经元组成，训练通过误差更新权重。',
    outcome: { status: 'ready' },
  });

  const audioStorageKey = `artifacts/audio-overview/${conversation.id}/stub.mp3`;
  const audioPath = path.join(OBJECT_STORAGE_ROOT, audioStorageKey);
  await mkdir(path.dirname(audioPath), { recursive: true });
  await writeFile(audioPath, AUDIO_BYTES);
  const checksum = createHash('sha256').update(AUDIO_BYTES).digest('hex');

  const artifact =
    await new dbModule.DrizzlePlatformArtifactRepository().createArtifact({
      spaceId: conversation.spaceId,
      conversationId,
      trustedSubjectId: conversation.ownerSubjectId,
      kind: 'audio_overview',
      trustTier: 'tier2',
      title: '音频来源概览',
    });
  await new dbModule.DrizzlePlatformArtifactRepository().appendVersion({
    artifactId: artifact.id,
    trustedSubjectId: conversation.ownerSubjectId,
    objectKey: audioStorageKey,
    checksum,
    generatedBy: 'e2e:audio-overview',
    content: null,
    metadata: {
      contentVersion: 1,
      contentType: 'audio/mpeg',
      byteSize: AUDIO_BYTES.length,
      transcript: '神经网络由多层神经元组成。',
      sourceCount: 1,
      script: {
        generator: 'e2e-rules',
        provider: 'fixture',
        resolvedModelId: 'fixture-script',
        inputTokens: 24,
        outputTokens: 12,
        latencyMs: 5,
      },
      speech: {
        provider: 'fixture',
        resolvedModelId: 'fixture-speech',
        voice: 'alloy',
        inputCharacters: 24,
        latencyMs: 9,
      },
    },
  });

  return {
    artifactId: artifact.id,
    conversationId,
    title: artifact.title,
  };
}
