import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { publicOutputViolations } from './public-output-boundary.mjs';

const governedCommon = {
  path: 'apps/gateway/src/http/common.ts',
  text: 'const publicBody = publicErrorEnvelope(errorCode);',
};

describe('public output boundary', () => {
  it('accepts approved Web and Gateway serializers', () => {
    assert.deepEqual(
      publicOutputViolations([
        governedCommon,
        {
          path: 'apps/web/app/api/v1/example/route.ts',
          text: "return jsonError(500, 'internal_error')",
        },
        {
          path: 'apps/gateway/src/socket.ts',
          text: "ws.send(serializePublicError('INVALID_REQUEST'))",
        },
      ]),
      [],
    );
  });

  it('rejects message metadata and direct HTTP or WebSocket error sinks', () => {
    const violations = publicOutputViolations([
      governedCommon,
      {
        path: 'apps/web/app/api/v1/example/route.ts',
        text: "new Response(JSON.stringify({ error: { code: 'x', message: secret } }))",
      },
      {
        path: 'apps/gateway/src/socket.ts',
        text: 'ws.send(JSON.stringify({ error: { code: hostile } }))',
      },
    ]);
    assert.equal(violations.length, 3);
  });
});
