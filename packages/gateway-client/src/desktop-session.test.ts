import { describe, expect, it } from 'vitest';
import { revokeGatewayDesktopSession } from './desktop-session';

describe('desktop Gateway session', () => {
  it('revokes with the strict bearer only', async () => {
    let seenUrl = '';
    let seenAuthorization = '';
    let seenBody: BodyInit | null | undefined;
    const token = `ecs1_${'t'.repeat(43)}`;
    await revokeGatewayDesktopSession('http://127.0.0.1:3200', token, (async (
      input,
      init,
    ) => {
      seenUrl = String(input);
      seenAuthorization = new Headers(init?.headers).get('authorization') ?? '';
      seenBody = init?.body;
      return new Response(null, { status: 204 });
    }) as typeof fetch);
    expect(seenUrl).toBe('http://127.0.0.1:3200/v1/client/session/revoke');
    expect(seenAuthorization).toBe(`Bearer ${token}`);
    expect(seenBody).toBeUndefined();
  });
});
