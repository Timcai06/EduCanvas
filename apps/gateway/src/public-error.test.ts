import { describe, expect, it } from 'vitest';
import { publicErrorEnvelope, serializePublicError } from './public-error';

describe('Gateway public error envelope', () => {
  it('contains only stable code and requestId', () => {
    expect(publicErrorEnvelope('INVALID_REQUEST', 'request-1')).toEqual({
      error: { code: 'INVALID_REQUEST', requestId: 'request-1' },
    });
  });

  it('does not serialize hostile exception, Provider, prompt or path content', () => {
    const hostile =
      'sk-secret SQL /Users/tim/private raw-provider prompt stack';
    const serialized = serializePublicError(hostile, hostile);
    expect(serialized).toContain('INTERNAL_ERROR');
    expect(serialized).not.toContain(hostile);
  });
});
