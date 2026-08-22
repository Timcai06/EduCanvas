import { timingSafeEqual } from 'node:crypto';
import { jsonError, jsonResponse } from '@/server/http/request-security';
import { getWebTelemetryRuntime } from '@/server/telemetry/telemetry-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function internalToken(): string | null {
  const token = process.env.EDUCANVAS_GATEWAY_INTERNAL_TOKEN?.trim();
  return token && Buffer.byteLength(token) >= 32 ? token : null;
}

function isAuthorized(request: Request, expectedToken: string): boolean {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(expectedToken);
  return (
    supplied.byteLength === expected.byteLength &&
    timingSafeEqual(supplied, expected)
  );
}

/** Read-only low-cardinality Web metrics; protected by the existing gateway internal token. */
export async function GET(request: Request): Promise<Response> {
  const token = internalToken();
  if (!token) {
    return jsonError(503, 'internal_metrics_disabled');
  }
  if (!isAuthorized(request, token)) {
    return jsonError(401, 'unauthorized');
  }
  try {
    const telemetry = getWebTelemetryRuntime();
    return jsonResponse({
      telemetry: {
        health: telemetry.health(),
        metrics: telemetry.metrics.snapshot(),
      },
    });
  } catch {
    return jsonError(503, 'internal_metrics_unavailable');
  }
}
