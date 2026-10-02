import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

const ACTIVE_CONVERSATION_COOKIE = '__Host-educanvas_active_conversation';
const STUDIO_TRIGGER_NAME = '打开全部资源';

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
  await page.getByRole('button', { name: '添加来源' }).click();
  await page.getByRole('menuitem', { name: '上传文件' }).click();
  await page
    .getByRole('dialog', { name: '上传文件' })
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
  // getDb 自 R 线起只从 internal subpath 导出（`@educanvas/db/internal`），默认入口不承载。
  const [dbModule, testingDbModule] = await Promise.all([
    import('@educanvas/db'),
    import('@educanvas/db/testing'),
  ]);
  const internalDbModule = testingDbModule;
  const drizzleModule = testingDbModule;
  const [conversation] = await internalDbModule
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

async function createGeneratedWebAppFixture(
  page: Page,
  title: string,
): Promise<RuntimeFixture> {
  const conversationId = await activeConversationId(page);
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
  const [dbModule, testingDbModule] = await Promise.all([
    import('@educanvas/db'),
    import('@educanvas/db/testing'),
  ]);
  const [conversation] = await testingDbModule
    .getDb()
    .select()
    .from(dbModule.conversations)
    .where(testingDbModule.eq(dbModule.conversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new Error('E2E 当前会话行不存在');

  const repository = new dbModule.DrizzlePlatformArtifactRepository();
  const artifact = await repository.createArtifact({
    spaceId: conversation.spaceId,
    conversationId,
    trustedSubjectId: conversation.ownerSubjectId,
    kind: 'web_app',
    trustTier: 'tier2',
    title,
  });
  const html = '<main id="runtime-result">Synthetic Web App 已执行</main>';
  const script =
    'window.educanvasRuntime.output("synthetic-web-app-ready"); setTimeout(() => window.educanvasRuntime.succeed(), 1_000);';
  const version = await repository.appendVersion({
    artifactId: artifact.id,
    trustedSubjectId: conversation.ownerSubjectId,
    generatedBy: 'e2e:web-runtime-offline-recovery:v1',
    content: {
      schemaVersion: 1,
      manifest: {
        entry: 'index.html',
        files: [
          {
            path: 'index.html',
            mediaType: 'text/html',
            content: html,
            hash: createHash('sha256').update(html, 'utf8').digest('hex'),
          },
          {
            path: 'app.js',
            mediaType: 'text/javascript',
            content: script,
            hash: createHash('sha256').update(script, 'utf8').digest('hex'),
          },
        ],
      },
      lockedDependencies: [],
      capabilities: ['dom-manipulation', 'css-render', 'javascript-runtime'],
      budget: {
        maxInputBytes: 1024,
        maxMessageBytes: 2048,
        maxOutputBytes: 4096,
        maxDurationMs: 10_000,
        maxConcurrentInstances: 1,
        maxQueueDepth: 1,
        maxMessagesPerSecond: 10,
      },
      diagnostics: [{ code: 'build_succeeded' }],
      sourceConversationId: conversationId,
      generatedByModel: true,
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
  const studio = page.getByRole('region', {
    name: '当前笔记本的资源控制台',
  });
  await expect(studio).toBeVisible();
  await studio.getByRole('tab', { name: /^输出/ }).click();
  await expect(studio.getByRole('list', { name: '输出列表' })).toBeVisible();
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
  test('生成的 Web App 在离线/Runtime 不可用时给出恢复指引并可重试执行', async ({
    page,
  }) => {
    await ensureGeneralNotebook(page);
    const title = `U12 Runtime Recovery ${Date.now()}`;
    await createGeneratedWebAppFixture(page, title);
    let admissions = 0;
    await page.route('**/api/v1/canvas/runtime/runs*', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      admissions += 1;
      if (admissions === 1) {
        await route.abort('failed');
        return;
      }
      if (admissions === 2) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'runtime_unavailable' } }),
        });
        return;
      }
      await route.continue();
    });
    await page.reload();

    const studio = await openStudioOutput(page);
    await studio.getByRole('button', { name: title }).click();
    const runtime = page.getByTestId('persistent-web-runtime');
    const status = page.getByTestId('runtime-status-message');
    await expect(runtime).toHaveAttribute('data-runtime-state', 'offline');
    await expect(status).toHaveText(
      '无法连接隔离运行环境，请检查网络或本地服务后重试。',
    );
    await runtime.getByRole('button', { name: '重试运行' }).click();

    await expect(runtime).toHaveAttribute('data-runtime-state', 'unavailable');
    await expect(status).toHaveText(
      '隔离运行环境暂不可用，请确认服务已启动后重试。',
    );
    await runtime.getByRole('button', { name: '重试运行' }).click();

    await expect(runtime).toHaveAttribute('data-runtime-state', 'running', {
      timeout: 30_000,
    });
    await expect(
      page
        .frameLocator('iframe[title="持久 Web Runtime"]')
        .frameLocator('iframe')
        .getByText('Synthetic Web App 已执行'),
    ).toBeVisible();
    await expect(runtime).toHaveAttribute('data-runtime-state', 'succeeded', {
      timeout: 30_000,
    });
  });

  test('真实 Web 打开不可变 Artifact Version，并由独立 Runtime 写入权威终态', async ({
    page,
  }) => {
    await ensureGeneralNotebook(page);
    const title = `U12 Runtime ${Date.now()}`;
    await createRuntimeFixture(page, title);
    await page.reload();

    const studio = await openStudioOutput(page);
    await studio.getByRole('button', { name: title }).click();

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
