import { expect, test, type Page } from '@playwright/test';

const ACTIVE_CONVERSATION_COOKIE = '__Host-educanvas_active_conversation';
const STUDIO_TRIGGER_NAME = '展开当前笔记本的输入与输出';

interface RuntimeFixture {
  artifactId: string;
  artifactVersionId: string;
  conversationId: string;
}

interface RunResponse {
  runId: string;
  bootstrapToken: string;
  runtimeOrigin: string;
}

async function activeConversationId(page: Page): Promise<string> {
  const value = (await page.context().cookies()).find(
    (cookie) => cookie.name === ACTIVE_CONVERSATION_COOKIE,
  )?.value;
  if (!value) throw new Error('E2E 当前会话 Cookie 不存在');
  return value;
}

async function ensureGeneralNotebook(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '添加上下文或创建内容' }).click();
  await page.getByRole('menuitem', { name: '上传文件' }).click();
  await page
    .getByRole('dialog', { name: '添加文档来源' })
    .getByRole('button', { name: '关闭' })
    .click();
  await expect.poll(() => activeConversationId(page)).toBeTruthy();
}

async function createRuntimeFixture(
  page: Page,
  title: string,
): Promise<RuntimeFixture> {
  const conversationId = await activeConversationId(page);
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
  const [dbModule, drizzleModule] = await Promise.all([
    import('../../packages/db/src/index.ts'),
    import('../../packages/db/node_modules/drizzle-orm/index.js'),
  ]);
  const [conversation] = await dbModule
    .getDb()
    .select()
    .from(dbModule.conversations)
    .where(drizzleModule.eq(dbModule.conversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new Error('E2E 当前会话行不存在');

  const repository = new dbModule.DrizzlePlatformArtifactRepository();
  const artifact = await repository.createArtifact({
    spaceId: conversation.spaceId,
    conversationId,
    trustedSubjectId: conversation.ownerSubjectId,
    kind: 'dom_exploration',
    trustTier: 'tier2',
    title,
  });
  const version = await repository.appendVersion({
    artifactId: artifact.id,
    trustedSubjectId: conversation.ownerSubjectId,
    generatedBy: 'e2e:web-runtime-composition:v1',
    content: {
      schemaVersion: 1,
      html: '<main id="runtime-result">真实 Runtime 已启动</main>',
      css: '#runtime-result { color: rgb(20 80 160); }',
      script:
        'window.educanvasRuntime.output("composition-ready"); setTimeout(() => window.educanvasRuntime.succeed(), 1_000);',
      dependencies: [],
    },
  });
  return {
    artifactId: artifact.id,
    artifactVersionId: version.id,
    conversationId,
  };
}

async function openStudioOutput(page: Page) {
  await page.getByRole('button', { name: STUDIO_TRIGGER_NAME }).click();
  const studio = page.getByRole('complementary', {
    name: '当前笔记本的 Studio',
  });
  const wheel = studio.getByRole('listbox', { name: '选择 Studio 能力' });
  await wheel.press('ArrowDown');
  await wheel.press('Enter');
  await expect(
    studio.getByRole('listbox', { name: '浏览当前Notebook的AI产物' }),
  ).toBeVisible();
  return studio;
}

async function createRun(
  page: Page,
  fixture: RuntimeFixture,
): Promise<{ status: number; body: RunResponse | null }> {
  return page.evaluate(async (input) => {
    const response = await fetch('/api/v1/canvas/runtime/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        artifactId: input.artifactId,
        artifactVersionId: input.artifactVersionId,
      }),
    });
    return {
      status: response.status,
      body: response.ok ? ((await response.json()) as RunResponse) : null,
    };
  }, fixture);
}

test.describe('Runtime Composition: real Web, Runtime and PostgreSQL', () => {
  test('真实 Web 打开不可变 Artifact Version，并由独立 Runtime 写入权威终态', async ({
    page,
  }) => {
    await ensureGeneralNotebook(page);
    const title = `U12 Runtime ${Date.now()}`;
    await createRuntimeFixture(page, title);
    await page.reload();

    const studio = await openStudioOutput(page);
    await studio.getByRole('option', { name: title }).click();

    const runtime = page.getByTestId('persistent-web-runtime');
    await expect(runtime).toBeVisible();
    await expect(page.getByTestId('runtime-host-frame')).toHaveAttribute(
      'src',
      /^http:\/\/runtime\.test:\d+\/host$/,
    );
    await expect(runtime).toHaveAttribute('data-runtime-state', 'succeeded', {
      timeout: 30_000,
    });
  });

  test('服务端从当前主体和 Notebook 重新授权，跨主体请求统一返回 404', async ({
    browser,
    page,
  }) => {
    await ensureGeneralNotebook(page);
    const fixture = await createRuntimeFixture(
      page,
      `U12 Cross Subject ${Date.now()}`,
    );

    const foreignContext = await browser.newContext();
    try {
      const foreignPage = await foreignContext.newPage();
      await ensureGeneralNotebook(foreignPage);
      const result = await createRun(foreignPage, fixture);
      expect(result).toEqual({ status: 404, body: null });
    } finally {
      await foreignContext.close();
    }
  });

  test('bootstrap 只可领取一次，terminal 必须在 bootstrap 后写入且不可重复', async ({
    page,
    request,
  }) => {
    await ensureGeneralNotebook(page);
    const fixture = await createRuntimeFixture(
      page,
      `U12 Terminal ${Date.now()}`,
    );
    const created = await createRun(page, fixture);
    expect(created.status).toBe(201);
    expect(created.body).not.toBeNull();
    const run = created.body!;

    const terminalBeforeBootstrap = await page.evaluate(async (runId) => {
      const response = await fetch(
        `/api/v1/canvas/runtime/runs/${encodeURIComponent(runId)}/terminal`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'succeeded' }),
        },
      );
      return response.status;
    }, run.runId);
    expect(terminalBeforeBootstrap).toBe(404);

    const runtimeLoopback = run.runtimeOrigin.replace(
      'runtime.test',
      '127.0.0.1',
    );
    const firstBootstrap = await request.post(
      `${runtimeLoopback}/api/bootstrap`,
      {
        data: {
          runId: run.runId,
          bootstrapToken: run.bootstrapToken,
        },
      },
    );
    expect(firstBootstrap.status()).toBe(200);
    const repeatedBootstrap = await request.post(
      `${runtimeLoopback}/api/bootstrap`,
      {
        data: {
          runId: run.runId,
          bootstrapToken: run.bootstrapToken,
        },
      },
    );
    expect(repeatedBootstrap.status()).toBe(404);

    const terminalStatuses = await page.evaluate(async (runId) => {
      const write = () =>
        fetch(
          `/api/v1/canvas/runtime/runs/${encodeURIComponent(runId)}/terminal`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'succeeded' }),
          },
        );
      const first = await write();
      const repeated = await write();
      return [first.status, repeated.status];
    }, run.runId);
    expect(terminalStatuses).toEqual([200, 404]);
  });
});
