import { expect, test, type Page } from '@playwright/test';
import {
  emitVoiceFinal,
  emitVoicePartial,
  holdNextVoiceTurn,
  installFakeLiveVoice,
  readFakeLiveVoiceSnapshot,
} from './fixtures/live-voice-fixture';

async function enterLiveWorkspace(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: '向 EduCanvas 提问' });
  await composer.fill('建立 Live Voice 测试会话');
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled();
  await composer.press('Enter');
  await expect
    .poll(
      async () => (await readFakeLiveVoiceSnapshot(page)).turnRequests.length,
    )
    .toBe(1);

  const launch = page.getByRole('button', { name: 'Live Voice' });
  await expect(launch).toBeEnabled();
  await launch.click();
  const dialog = page.getByRole('dialog', { name: 'Live Voice' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => (await readFakeLiveVoiceSnapshot(page)).readyConnections)
    .toBeGreaterThanOrEqual(1);
  return dialog;
}

function textFromTurn(request: Record<string, unknown>): string | null {
  if (typeof request.text === 'string') return request.text;
  if (!Array.isArray(request.parts)) return null;
  const text = request.parts.find(
    (part): part is { type: string; text: string } =>
      typeof part === 'object' &&
      part !== null &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string',
  );
  return text?.text ?? null;
}

test.beforeEach(async ({ page }) => {
  await installFakeLiveVoice(page);
});

test('@smoke Live Voice 连续两轮只提交唯一 Turn，并按播放时钟呈现回答', async ({
  page,
}) => {
  const dialog = await enterLiveWorkspace(page);

  await emitVoicePartial(page, '请先检索实验资料');
  await expect(dialog.getByText('请先检索实验资料')).toBeVisible();
  await emitVoiceFinal(page, '请先检索实验资料');

  await expect
    .poll(
      async () => (await readFakeLiveVoiceSnapshot(page)).turnRequests.length,
    )
    .toBe(2);
  await expect(
    dialog.locator('[data-status="completed"]').filter({
      hasText: '正在检索资料',
    }),
  ).toContainText('已完成');
  await expect
    .poll(async () => (await readFakeLiveVoiceSnapshot(page)).speechRequests)
    .toBeGreaterThanOrEqual(1);
  await expect(dialog.getByText('正在回答')).toBeVisible();

  await expect
    .poll(async () => (await readFakeLiveVoiceSnapshot(page)).readyConnections)
    .toBeGreaterThanOrEqual(2);
  await emitVoicePartial(page, '再给出第二个结论');
  await expect(dialog.getByText('再给出第二个结论')).toBeVisible();
  await emitVoiceFinal(page, '再给出第二个结论');

  await expect
    .poll(
      async () => (await readFakeLiveVoiceSnapshot(page)).turnRequests.length,
    )
    .toBe(3);
  await expect
    .poll(async () => (await readFakeLiveVoiceSnapshot(page)).readyConnections)
    .toBeGreaterThanOrEqual(3);
  const snapshot = await readFakeLiveVoiceSnapshot(page);
  expect(snapshot.turnRequests.slice(1).map(textFromTurn)).toEqual([
    '请先检索实验资料',
    '再给出第二个结论',
  ]);
  expect(
    snapshot.clientFrameTypes.filter((type) => type === 'start'),
  ).toHaveLength(3);

  await expect(dialog.getByText('正在聆听')).toBeVisible({ timeout: 8_000 });
  await dialog.getByRole('button', { name: '结束 Live Voice' }).click();
  await expect(dialog).toHaveCount(0);
});

test('Live Voice 插话先清空播放并取消 Turn，再用不可变 Asset 快照恢复', async ({
  page,
}) => {
  const dialog = await enterLiveWorkspace(page);
  const contextRail = dialog.getByRole('list', { name: 'Live 上下文' });
  await expect(
    contextRail.getByRole('listitem').filter({ hasText: '电路图.png' }),
  ).toBeVisible();
  await expect(
    contextRail.getByRole('listitem').filter({ hasText: '实验记录.pdf' }),
  ).toBeVisible();
  await expect(
    dialog.getByTitle(/处理中资料\.pdf · 处理中 · 本轮暂不带入/),
  ).toBeVisible();

  await holdNextVoiceTurn(
    page,
    '这是一个持续播报中的回答，用来验证插话会立即停止声音。',
  );
  await emitVoicePartial(page, '分析当前图片和文档');
  await emitVoiceFinal(page, '分析当前图片和文档');
  await expect
    .poll(
      async () => (await readFakeLiveVoiceSnapshot(page)).turnRequests.length,
    )
    .toBe(2);
  await expect
    .poll(async () => (await readFakeLiveVoiceSnapshot(page)).speechRequests)
    .toBeGreaterThanOrEqual(1);
  await expect(dialog.getByText('正在回答')).toBeVisible();

  await expect
    .poll(async () => (await readFakeLiveVoiceSnapshot(page)).readyConnections)
    .toBeGreaterThanOrEqual(2);
  await emitVoicePartial(page, '停一下，改为比较两份资料');
  await expect(dialog.getByText('停一下，改为比较两份资料')).toBeVisible();
  await expect
    .poll(async () => (await readFakeLiveVoiceSnapshot(page)).speechAborts)
    .toBeGreaterThanOrEqual(1);
  await emitVoiceFinal(page, '停一下，改为比较两份资料');

  await expect
    .poll(async () => (await readFakeLiveVoiceSnapshot(page)).cancelRequests)
    .toEqual(['fake-turn-2']);
  await expect
    .poll(
      async () => (await readFakeLiveVoiceSnapshot(page)).turnRequests.length,
    )
    .toBe(3);

  const snapshot = await readFakeLiveVoiceSnapshot(page);
  const speechAbort = snapshot.events.indexOf('speech.abort');
  const turnCancel = snapshot.events.indexOf('turn.cancel');
  const resumedTurn = snapshot.events.lastIndexOf('turn.request');
  expect(speechAbort).toBeGreaterThan(-1);
  expect(turnCancel).toBeGreaterThan(speechAbort);
  expect(resumedTurn).toBeGreaterThan(turnCancel);

  for (const request of snapshot.turnRequests.slice(1)) {
    expect(request.parts).toEqual([
      { type: 'text', text: textFromTurn(request) },
      {
        type: 'asset_ref',
        reference: {
          assetId: 'asset-image-1',
          versionId: 'version-image-7',
          kind: 'image',
        },
        usage: 'context',
      },
      {
        type: 'asset_ref',
        reference: {
          assetId: 'asset-doc-1',
          versionId: 'version-doc-3',
          kind: 'document',
        },
        usage: 'context',
      },
    ]);
    expect(JSON.stringify(request)).not.toContain('asset-processing-1');
  }

  await dialog.getByRole('button', { name: '结束 Live Voice' }).click();
});
