import { expect, test, type Page, type Route } from '@playwright/test';

const SEARCH_RESULTS = [
  {
    title: '检索结果一',
    url: 'https://web.example.test/one',
    domain: 'web.example.test',
    snippet: '第一条网页来源摘要。',
    accessibility: 'accessible' as const,
    imported: false,
  },
  {
    title: '检索结果二',
    url: 'https://web.example.test/two',
    domain: 'web.example.test',
    snippet: '第二条网页来源摘要。',
    accessibility: 'unchecked' as const,
    imported: false,
  },
  {
    title: '检索结果三',
    url: 'https://web.example.test/three',
    domain: 'web.example.test',
    snippet: '第三条网页来源摘要。',
    accessibility: 'unavailable' as const,
    imported: false,
  },
];

const IMPORTED_ASSETS = SEARCH_RESULTS.map((result, index) => ({
  descriptor: {
    assetId: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index + 1}`,
    scope: 'space' as const,
    kind: 'link' as const,
    displayName: result.title,
    status: 'ready' as const,
    currentVersionId: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${index + 1}`,
  },
  version: {
    versionId: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${index + 1}`,
  },
  processing: null,
  canvasResource: null,
  enabled: true,
}));

function assetListResponse(assets: readonly unknown[]) {
  return { assets };
}

async function routeAssetApis(
  route: Route,
  state: {
    importedBodies: string[];
    imported: typeof IMPORTED_ASSETS;
    releaseImports: (() => void) | null;
    importsReleased: Promise<void>;
    searchFailure: boolean;
  },
) {
  const request = route.request();
  const url = new URL(request.url());

  if (url.pathname === '/api/v1/chat/assets' && request.method() === 'GET') {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(assetListResponse(state.imported)),
    });
    return;
  }

  if (
    url.pathname === '/api/v1/chat/assets/link/search' &&
    request.method() === 'POST'
  ) {
    if (state.searchFailure) {
      state.searchFailure = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'search_provider_unavailable',
            message: '网页搜索暂时不可用。请稍后重试。',
            retryable: true,
          },
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ results: SEARCH_RESULTS }),
    });
    return;
  }

  if (
    url.pathname === '/api/v1/chat/assets/link' &&
    request.method() === 'POST'
  ) {
    const body = request.postDataJSON() as { url?: unknown };
    if (typeof body.url !== 'string') {
      await route.fulfill({ status: 400, body: '{}' });
      return;
    }
    state.importedBodies.push(body.url);
    await state.importsReleased;
    const index = SEARCH_RESULTS.findIndex((result) => result.url === body.url);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ asset: state.imported[index] }),
    });
    return;
  }

  await route.fallback();
}

async function openSearchPanel(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '添加来源' }).click();
  await page.getByRole('menuitem', { name: '导入网页' }).click();
  const sheet = page.getByRole('dialog', { name: '导入网页来源' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('tab', { name: '搜索网页' }).click();
  return sheet;
}

function researchStream() {
  const encoder = new TextEncoder();
  const turnId = 'deep-research-turn-e2e';
  const messageId = 'deep-research-message-e2e';
  const frame = (type: string, data: Record<string, unknown>) =>
    encoder.encode(
      `event: ${type}\ndata: ${JSON.stringify({ type, schemaVersion: '1', turnId, ...data })}\n\n`,
    );
  const frames: Uint8Array[] = [
    frame('turn.accepted', {
      studentMessageId: 'deep-research-student-e2e',
      assistantMessageId: messageId,
      replayed: false,
    }),
  ];
  for (let index = 1; index <= 5; index += 1) {
    frames.push(
      frame('tool.started', {
        toolCallId: `fetch-${index}`,
        activity: 'web_fetch',
      }),
      frame('tool.completed', { toolCallId: `fetch-${index}` }),
    );
  }
  frames.push(
    frame('message.delta', {
      messageId,
      delta: '五份来源共同支持这项研究结论。',
    }),
  );
  for (let index = 1; index <= 5; index += 1) {
    frames.push(
      frame('message.citation', {
        messageId,
        citationId: `deep-citation-${index}`,
        marker: index,
        kind: 'web',
        assetId: `asset-web-${index}`,
        assetVersionId: `asset-version-web-${index}`,
        label: `研究来源 ${index}`,
        url: `https://web.example.test/research-${index}`,
        pageStart: null,
        pageEnd: null,
      }),
    );
  }
  return Buffer.concat(frames).toString();
}

test('@smoke WS09 内置搜索支持多选与批量导入', async ({ page }) => {
  test.slow();
  let releaseImports!: () => void;
  const importsReleased = new Promise<void>((resolve) => {
    releaseImports = resolve;
  });
  const state = {
    importedBodies: [] as string[],
    imported: [] as typeof IMPORTED_ASSETS,
    releaseImports,
    importsReleased,
    searchFailure: false,
  };
  await page.route('**/api/v1/chat/assets**', (route) =>
    routeAssetApis(route, state),
  );

  const sheet = await openSearchPanel(page);
  await sheet.getByLabel('检索词').fill('生成式 AI 教学研究');
  await sheet.getByRole('button', { name: '搜索' }).click();
  await expect(
    sheet.getByRole('heading', { name: '搜索结果（3）' }),
  ).toBeVisible();

  await sheet.getByLabel('选择 检索结果一').check();
  await sheet.getByLabel('选择 检索结果二').check();
  await expect(
    sheet.getByRole('button', { name: '导入所选网页（2）' }),
  ).toBeEnabled();
  await sheet.getByRole('button', { name: '导入所选网页（2）' }).click();

  await expect.poll(() => state.importedBodies.length).toBe(2);
  state.imported = IMPORTED_ASSETS.filter((asset) =>
    state.importedBodies.includes(
      SEARCH_RESULTS[IMPORTED_ASSETS.indexOf(asset)]!.url,
    ),
  );
  await expect.poll(() => state.imported.length).toBe(2);
  releaseImports();

  await expect
    .poll(() => page.getByRole('dialog', { name: '导入网页来源' }).count())
    .toBe(0);
  const refreshedAssets = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/v1/chat/assets' &&
      response.request().method() === 'GET' &&
      response.ok()
    );
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const refreshedPayload = (await refreshedAssets).json() as Promise<{
    assets: readonly { descriptor: { displayName: string } }[];
  }>;
  const refreshedBody = await refreshedPayload;
  expect(refreshedBody.assets).toHaveLength(2);
  expect(
    refreshedBody.assets.map((asset) => asset.descriptor.displayName),
  ).toEqual(['检索结果一', '检索结果二']);
});

test('@smoke WS09 搜索失败投影稳定且可重试', async ({ page }) => {
  const state = {
    importedBodies: [] as string[],
    imported: [] as typeof IMPORTED_ASSETS,
    releaseImports: null,
    importsReleased: Promise.resolve(),
    searchFailure: true,
  };
  await page.route('**/api/v1/chat/assets**', (route) =>
    routeAssetApis(route, state),
  );

  const sheet = await openSearchPanel(page);
  await sheet.getByLabel('检索词').fill('稳定失败投影');
  await sheet.getByRole('button', { name: '搜索' }).click();
  await expect(sheet.getByRole('alert')).toContainText(
    '网页搜索暂时不可用。请稍后重试。',
  );
  await expect(sheet.getByRole('button', { name: '重试搜索' })).toBeVisible();
  await sheet.getByRole('button', { name: '重试搜索' }).click();
  await expect(
    sheet.getByRole('heading', { name: '搜索结果（3）' }),
  ).toBeVisible();
});

test('@smoke WS09 深度研究显示五源五引与综合进度', async ({ page }) => {
  const state = {
    importedBodies: [] as string[],
    imported: [] as typeof IMPORTED_ASSETS,
    releaseImports: null,
    importsReleased: Promise.resolve(),
    searchFailure: false,
  };
  await page.route('**/api/v1/chat/assets**', (route) =>
    routeAssetApis(route, state),
  );
  await page.route('**/api/v1/chat/turn', async (route) => {
    await route.fulfill({
      contentType: 'text/event-stream; charset=utf-8',
      body: researchStream(),
    });
  });

  const sheet = await openSearchPanel(page);
  await sheet.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('dialog', { name: '导入网页来源' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: '深度研究' }).click();
  const launcher = page.getByRole('dialog', { name: '开始深度研究' });
  await launcher.getByPlaceholder('例如：光合作用的研究进展').fill('研究主题');
  await launcher.getByRole('button', { name: '开始研究' }).click();

  await expect(page.getByText('正在综合报告 · 5 个来源')).toBeVisible();
  await expect(page.getByText('五份来源共同支持这项研究结论。')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /打开来源 研究来源/ }),
  ).toHaveCount(5);
  await expect(
    page.getByRole('link', { name: /打开原网页 研究来源/ }),
  ).toHaveCount(5);
});
