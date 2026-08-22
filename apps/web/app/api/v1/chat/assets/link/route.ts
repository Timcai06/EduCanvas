import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  AssetUploadError,
  importOwnedLinkAsset,
} from '@/server/assets/asset-upload';
import {
  linkTrafficKey,
  linkTrafficLimiter,
} from '@/server/assets/link-traffic-limiter';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readLimitedJsonRequest,
} from '@/server/http/json-request';
import { z } from 'zod';
import { NOOP_METRICS, recordMetricSafely } from '@educanvas/telemetry';
import { getWebTelemetryRuntime } from '@/server/telemetry/telemetry-runtime';
import {
  LinkImportError,
  linkErrorResponse,
  normalizePublicLinkError,
} from './link-error-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const linkImportSchema = z
  .object({ url: z.string().trim().min(8).max(1024) })
  .strict();

/** 链接导入为来源:服务端抓取公开网页正文,落为 link 资产版本。 */
export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  let identity;
  let conversation;
  try {
    identity = await readAnonymousIdentity();
    if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
    conversation = await loadOwnedGeneralConversation(identity);
    if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');
  } catch {
    return linkErrorResponse(
      new LinkImportError('link_import_unavailable', true),
    );
  }

  let body: unknown;
  try {
    body = await readLimitedJsonRequest(request);
  } catch (error) {
    if (error instanceof JsonRequestValidationError) {
      return jsonRequestErrorResponse(error);
    }
    return linkErrorResponse(
      new LinkImportError('link_import_unavailable', true),
    );
  }
  const parsed = linkImportSchema.safeParse(body);
  if (!parsed.success) {
    return linkErrorResponse(new LinkImportError('link_invalid_url', false));
  }

  let lease;
  let metrics = NOOP_METRICS;
  try {
    metrics = getWebTelemetryRuntime().metrics;
  } catch {
    // Observability configuration must never block the import boundary.
  }
  const startedAt = Date.now();
  let metricOutcome: 'success' | 'failed' | 'cancelled' | 'rate_limited' =
    'failed';
  try {
    lease = linkTrafficLimiter.acquire(
      linkTrafficKey(identity.studentId, conversation.spaceId),
    );
    if (!lease.allowed) {
      metricOutcome = 'rate_limited';
      return linkErrorResponse(
        new LinkImportError('link_rate_limited', true),
        lease.retryAfterMs,
      );
    }
    const importInput = {
      identity,
      spaceId: conversation.spaceId,
      url: parsed.data.url,
      signal: request.signal,
    };
    const asset = await importOwnedLinkAsset(importInput);
    metricOutcome = 'success';
    return jsonResponse({ asset }, { status: 201 });
  } catch (error) {
    if (request.signal.aborted) metricOutcome = 'cancelled';
    if (error instanceof AssetUploadError) {
      return linkErrorResponse(normalizePublicLinkError(error.code));
    }
    return linkErrorResponse(
      new LinkImportError('link_import_unavailable', true),
    );
  } finally {
    if (lease?.allowed) lease.release();
    recordMetricSafely(() =>
      metrics.increment('web_link_import_total', { outcome: metricOutcome }),
    );
    recordMetricSafely(() =>
      metrics.record('web_link_import_duration_ms', Date.now() - startedAt, {
        outcome: metricOutcome,
      }),
    );
  }
}
