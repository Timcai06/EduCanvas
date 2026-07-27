import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const listSource = readFileSync(join(directory, 'route.ts'), 'utf8');
const connectSource = readFileSync(join(directory, 'connect/route.ts'), 'utf8');
const revokeSource = readFileSync(join(directory, 'revoke/route.ts'), 'utf8');

describe('Web connection routes', () => {
  it('always scopes reads and mutations to the authenticated Web identity', () => {
    expect(listSource).toContain('.list(identity.studentId)');
    expect(connectSource).toContain('userId: identity.studentId');
    expect(revokeSource).toContain('userId: identity.studentId');
    expect(connectSource).not.toContain('raw.userId');
    expect(revokeSource).not.toContain('raw.userId');
  });

  it('gates both writes by same-origin validation before parsing payloads', () => {
    for (const source of [connectSource, revokeSource]) {
      expect(source).toContain('isTrustedSameOriginWrite(request)');
      expect(source.indexOf('isTrustedSameOriginWrite(request)')).toBeLessThan(
        source.indexOf('readLimitedJsonRequest(request)'),
      );
      expect(source).not.toContain('request.json()');
    }
  });

  it('uses strict provider-neutral request contracts', () => {
    expect(connectSource).toContain(
      'gatewayConnectionConnectRequestSchema.safeParse(raw)',
    );
    expect(revokeSource).toContain(
      'gatewayConnectionRevokeRequestSchema.safeParse(raw)',
    );
    expect(connectSource).not.toContain('externalAccountId');
    expect(connectSource).not.toContain('adapterId');
  });
});
