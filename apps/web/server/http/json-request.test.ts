import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readLimitedJsonRequest,
} from './json-request';

const request = (
  body: BodyInit | null,
  contentType = 'application/json',
): Request =>
  new Request('https://app.example/api/test', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });

describe('limited JSON request reader', () => {
  it('parses valid JSON without exposing route-specific contracts', async () => {
    await expect(
      readLimitedJsonRequest(request(JSON.stringify({ ok: true }))),
    ).resolves.toEqual({ ok: true });
  });

  it('rejects non-JSON content types before reading the body', async () => {
    await expect(
      readLimitedJsonRequest(request('{}', 'text/plain')),
    ).rejects.toMatchObject({
      code: 'invalid_content_type',
    });
  });

  it('rejects oversized bodies before JSON parsing', async () => {
    await expect(
      readLimitedJsonRequest(request('x'.repeat(10)), { maxBytes: 4 }),
    ).rejects.toMatchObject({ code: 'request_too_large' });
  });

  it('maps validation errors to stable public responses', async () => {
    const response = jsonRequestErrorResponse(
      new JsonRequestValidationError('request_too_large'),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'request_too_large' },
    });
  });
});
