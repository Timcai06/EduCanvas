import { expect, test } from '@playwright/test';

test('根入口默认创建通用Chat，界面上不存在K12模式入口', async ({
  context,
  page,
}) => {
  await page.route('**/api/v1/chat/turn', async (route) => {
    const encoder = new TextEncoder();
    const turnId = 'general-turn-e2e';
    const messageId = 'general-assistant-e2e';
    const frame = (type: string, data: Record<string, unknown>) =>
      encoder.encode(
        `event: ${type}\ndata: ${JSON.stringify({ type, schemaVersion: '1', ...data })}\n\n`,
      );
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: Buffer.concat([
        frame('turn.accepted', {
          turnId,
          studentMessageId: 'general-student-e2e',
          assistantMessageId: messageId,
          replayed: false,
        }),
        frame('message.delta', {
          turnId,
          messageId,
          delta: '我们先明确目标，再选择最合适的实现路径。',
        }),
        frame('turn.completed', { turnId, messageId }),
      ]).toString(),
    });
  });

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '今天想学点什么？' }),
  ).toBeVisible();
  /* 产品决策:多模态 Agent 是第一身份,不存在"K12 模式"入口(student-ui-spec) */
  await expect(page.getByRole('link', { name: 'K12 学习模式' })).toHaveCount(0);
  await expect(page.getByText(/猫狗|学习进度|开始学习/)).toHaveCount(0);

  const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
  await composer.fill('帮我分析一个产品想法');
  await composer.press('Enter');

  await expect(page.getByText('帮我分析一个产品想法')).toBeVisible();
  await expect(
    page.getByText('我们先明确目标，再选择最合适的实现路径。'),
  ).toBeVisible();
  /* 当前Notebook出现在列表(本 spec 的 turn 被 mock,服务端不落
     消息,标题保持空;真实标题=首条消息的行为由仓储层保证) */
  await expect(
    page.getByRole('navigation', { name: '笔记本' }).getByText('未命名笔记本'),
  ).toBeVisible();

  /* U2 v1:来源常驻区在侧栏可见 */
  await expect(
    page
      .getByRole('navigation', { name: '笔记本' })
      .getByText('来源', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '上传 PDF 来源' }),
  ).toBeVisible();

  const cookieNames = (await context.cookies())
    .filter((cookie) => cookie.httpOnly && cookie.path === '/')
    .map((cookie) => cookie.name);
  expect(cookieNames).toContain('__Host-educanvas_anonymous_identity');
  expect(cookieNames).toContain('__Host-educanvas_active_conversation');
});

test('笔记本可反复切换，并整体恢复各自的消息', async ({ page }) => {
  const firstPrompt = '太阳能小车研究笔记本';
  const secondPrompt = '校园雨水花园笔记本';

  await page.goto('/');
  const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
  await composer.fill(firstPrompt);
  await composer.press('Enter');
  await expect(
    page
      .getByRole('region', { name: 'AI 对话' })
      .getByText(firstPrompt, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('AI 暂时无法回答，请稍后重试。')).toBeVisible();

  const notebooks = page.getByRole('navigation', { name: '笔记本' });
  await notebooks.getByRole('button', { name: '新建笔记本' }).click();
  await expect(
    page.getByRole('heading', { name: '今天想学点什么？' }),
  ).toBeVisible();

  await page
    .getByRole('textbox', { name: '向 EduCanvas 提问' })
    .fill(secondPrompt);
  await page.getByRole('textbox', { name: '向 EduCanvas 提问' }).press('Enter');
  await expect(
    page
      .getByRole('region', { name: 'AI 对话' })
      .getByText(secondPrompt, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('AI 暂时无法回答，请稍后重试。')).toBeVisible();

  await page
    .getByRole('navigation', { name: '笔记本' })
    .getByRole('button', { name: new RegExp(firstPrompt) })
    .click();
  let chat = page.getByRole('region', { name: 'AI 对话' });
  await expect(chat.getByText(firstPrompt, { exact: true })).toBeVisible();
  await expect(chat.getByText(secondPrompt, { exact: true })).toHaveCount(0);

  await page
    .getByRole('navigation', { name: '笔记本' })
    .getByRole('button', { name: new RegExp(secondPrompt) })
    .click();
  chat = page.getByRole('region', { name: 'AI 对话' });
  await expect(chat.getByText(secondPrompt, { exact: true })).toBeVisible();
  await expect(chat.getByText(firstPrompt, { exact: true })).toHaveCount(0);
});

test('切换笔记本时 Sources 与 Studio 作为整体隔离', async ({ page }) => {
  const firstPrompt = '第一本：机器视觉资料';
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
  await composer.fill(firstPrompt);
  await composer.press('Enter');
  await expect(
    page
      .getByRole('region', { name: 'AI 对话' })
      .getByText(firstPrompt, { exact: true }),
  ).toBeVisible();
  /* 学生消息先乐观渲染；等服务端终态后再读取权威Conversation标题，避免与POST并发。 */
  await expect(page.getByText('AI 暂时无法回答，请稍后重试。')).toBeVisible();

  const firstConversationId = await page.evaluate(async () => {
    const response = await fetch('/api/v1/chat/conversations');
    const payload = (await response.json()) as {
      conversations: Array<{ id: string; title: string | null }>;
    };
    const current = payload.conversations.find(
      (conversation) => conversation.title === '第一本：机器视觉资料',
    );
    if (!current) throw new Error('第一本笔记本不存在');
    return current.id;
  });

  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
  const [dbModule, drizzleModule] = await Promise.all([
    import('../../packages/db/src/index.ts'),
    import('../../packages/db/node_modules/drizzle-orm/index.js'),
  ]);
  const [conversation] = await dbModule
    .getDb()
    .select()
    .from(dbModule.conversations)
    .where(drizzleModule.eq(dbModule.conversations.id, firstConversationId))
    .limit(1);
  if (!conversation) throw new Error('第一本笔记本行不存在');

  await new dbModule.DrizzleAssetRepository().createUploaded({
    ownerSubjectId: conversation.ownerSubjectId,
    spaceId: conversation.spaceId,
    scope: 'space',
    kind: 'document',
    displayName: '第一本视觉讲义.pdf',
    mimeType: 'application/pdf',
    byteSize: 128,
    contentHash: 'c'.repeat(64),
    storageKey: `e2e/${conversation.id}/notebook-source.pdf`,
    extractedText: '卷积神经网络可以提取图像特征。',
    outcome: { status: 'ready' },
  });
  const firstArtifact =
    await new dbModule.DrizzlePlatformArtifactRepository().createArtifact({
      spaceId: conversation.spaceId,
      trustedSubjectId: conversation.ownerSubjectId,
      kind: 'mind_map',
      trustTier: 'tier1',
      title: '第一本视觉导图',
    });

  await page.reload();
  await expect(page.getByText('第一本视觉讲义.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Studio', exact: true }).click();
  let studio = page.getByRole('dialog', { name: '当前笔记本的 Studio' });
  await expect(studio.getByText('第一本视觉导图')).toBeVisible();
  await studio.getByRole('button', { name: '关闭' }).click();

  await page
    .getByRole('navigation', { name: '笔记本' })
    .getByRole('button', { name: '新建笔记本' })
    .click();
  await expect(page.getByText('第一本视觉讲义.pdf')).toHaveCount(0);
  await page.getByRole('button', { name: 'Studio', exact: true }).click();
  studio = page.getByRole('dialog', { name: '当前笔记本的 Studio' });
  await expect(studio.getByText('第一本视觉导图')).toHaveCount(0);
  await studio.getByRole('button', { name: '关闭' }).click();
  await expect(
    page.evaluate(async (artifactId) => {
      const response = await fetch(`/api/v1/chat/artifacts/${artifactId}`);
      return response.status;
    }, firstArtifact.id),
  ).resolves.toBe(404);

  await page
    .getByRole('navigation', { name: '笔记本' })
    .getByRole('button', { name: /第一本：机器视觉资料/ })
    .click();
  await expect(page.getByText('第一本视觉讲义.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Studio', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: '当前笔记本的 Studio' })
      .getByText('第一本视觉导图'),
  ).toBeVisible();
});

test('Scripted：搜索并读取多个网页后，以稳定编号展示可打开的原文引用', async ({
  page,
}) => {
  await page.route('**/api/v1/chat/turn', async (route) => {
    const encoder = new TextEncoder();
    const turnId = 'web-research-turn-e2e';
    const messageId = 'web-research-assistant-e2e';
    const frame = (type: string, data: Record<string, unknown>) =>
      encoder.encode(
        `event: ${type}\ndata: ${JSON.stringify({ type, schemaVersion: '1', turnId, ...data })}\n\n`,
      );
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: Buffer.concat([
        frame('turn.accepted', {
          studentMessageId: 'web-research-student-e2e',
          assistantMessageId: messageId,
          replayed: false,
        }),
        frame('tool.started', {
          toolCallId: 'search-1',
          label: '正在搜索网页',
        }),
        frame('tool.completed', { toolCallId: 'search-1' }),
        frame('tool.started', {
          toolCallId: 'page-1',
          label: '正在读取网页',
        }),
        frame('tool.completed', { toolCallId: 'page-1' }),
        frame('tool.started', {
          toolCallId: 'page-2',
          label: '正在读取网页',
        }),
        frame('tool.completed', { toolCallId: 'page-2' }),
        frame('message.delta', {
          messageId,
          delta:
            '第一份资料说明方案重视可达性 [1]；第二份资料给出了学习收益证据 [2]。',
        }),
        frame('message.citation', {
          messageId,
          citationId: 'web-citation-1',
          marker: 1,
          kind: 'web',
          assetId: 'asset-web-1',
          assetVersionId: 'asset-version-web-1',
          label: '可达性设计指南',
          url: 'https://example.com/accessibility',
          pageStart: null,
          pageEnd: null,
        }),
        frame('message.citation', {
          messageId,
          citationId: 'web-citation-2',
          marker: 2,
          kind: 'web',
          assetId: 'asset-web-2',
          assetVersionId: 'asset-version-web-2',
          label: '学习收益研究',
          url: 'https://example.org/learning-study',
          pageStart: null,
          pageEnd: null,
        }),
        frame('turn.completed', { messageId }),
      ]).toString(),
    });
  });

  await page.goto('/');
  const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
  await composer.fill('搜索网页并比较两份资料');
  await composer.press('Enter');

  await expect(page.getByText(/第一份资料说明方案重视可达性/)).toBeVisible();
  const firstSource = page.getByRole('link', { name: /1 可达性设计指南/ });
  const secondSource = page.getByRole('link', { name: /2 学习收益研究/ });
  await expect(firstSource).toHaveAttribute(
    'href',
    'https://example.com/accessibility',
  );
  await expect(secondSource).toHaveAttribute(
    'href',
    'https://example.org/learning-study',
  );
  await expect(firstSource).toHaveAttribute('target', '_blank');
});
