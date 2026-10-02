import { expect, test } from '@playwright/test';
import {
  createArtifactConfirmationFixture,
  readArtifactConfirmation,
} from './fixtures/artifact-confirmation-fixture';
import { ensureGeneralNotebook } from './fixtures/general-artifact-fixture';

test('proposal can be edited, survives refresh, is scope-bound, and can be cancelled', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ensureGeneralNotebook(page);
  const fixture = await createArtifactConfirmationFixture(
    page,
    '确认卡持久化验证',
  );

  await page.goto(
    `/notebook/${fixture.notebookId}/conversation/${fixture.conversationId}`,
  );
  const card = page.getByRole('region', { name: '确认产物类型' });
  await expect(card).toBeVisible();
  await expect(card.getByText('确认卡持久化验证')).toBeVisible();
  await expect(card.getByLabel('类型')).toHaveValue('note');

  const crossScope = await page.evaluate(
    async (input) => {
      const response = await fetch(
        `/api/v1/chat/artifact-confirmations/${encodeURIComponent(input.confirmationId)}?requestNotebookId=${encodeURIComponent(input.notebookId)}&requestConversationId=${encodeURIComponent(input.conversationId)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'cancel' }),
        },
      );
      return response.status;
    },
    {
      confirmationId: fixture.confirmationId,
      notebookId: fixture.otherNotebookId,
      conversationId: fixture.otherConversationId,
    },
  );
  expect(crossScope).toBe(404);
  expect((await readArtifactConfirmation(fixture.confirmationId)).status).toBe(
    'pending',
  );

  // Exercise the real confirmation edit route, but keep the model turn offline.
  await page.route('**/api/v1/chat/turn**', async (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'e2e_model_unavailable', message: 'Fixture only' },
      }),
    }),
  );
  await card.getByLabel('类型').selectOption('slides');
  await card.getByRole('button', { name: '确认并创建' }).click();
  await expect(card.getByRole('alert')).toBeVisible();
  let stored = await readArtifactConfirmation(fixture.confirmationId);
  expect(stored.status).toBe('pending');
  expect(stored.artifactKind).toBe('slides');

  await page.reload();
  const recoveredCard = page.getByRole('region', { name: '确认产物类型' });
  await expect(recoveredCard).toBeVisible();
  await expect(recoveredCard.getByLabel('类型')).toHaveValue('slides');
  await recoveredCard
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(recoveredCard).toHaveCount(0);
  stored = await readArtifactConfirmation(fixture.confirmationId);
  expect(stored.status).toBe('cancelled');

  await page.reload();
  await expect(page.getByRole('region', { name: '确认产物类型' })).toHaveCount(
    0,
  );
});
