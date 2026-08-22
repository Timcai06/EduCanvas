import { randomUUID } from 'node:crypto';

export interface PublicErrorEnvelope {
  error: {
    code: string;
    requestId: string;
  };
}

export function publicErrorEnvelope(
  code: string,
  requestId: string = randomUUID(),
): PublicErrorEnvelope {
  const safeCode = /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(code)
    ? code
    : 'INTERNAL_ERROR';
  const safeRequestId = /^[A-Za-z0-9_.:-]{1,128}$/.test(requestId)
    ? requestId
    : randomUUID();
  return { error: { code: safeCode, requestId: safeRequestId } };
}

export function serializePublicError(code: string, requestId?: string): string {
  return JSON.stringify(publicErrorEnvelope(code, requestId));
}

export function publicErrorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body))
    return null;
  const error = body.error;
  if (typeof error !== 'object' || error === null || !('code' in error))
    return null;
  return typeof error.code === 'string' ? error.code : null;
}
