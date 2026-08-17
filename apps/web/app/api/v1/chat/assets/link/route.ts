import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  AssetUploadError,
  importOwnedLinkAsset,
} from '@/server/assets/asset-upload';
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
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');

  let body: unknown;
  try {
    body = await readLimitedJsonRequest(request);
  } catch (error) {
    if (error instanceof JsonRequestValidationError) {
      return jsonRequestErrorResponse(error);
    }
    throw error;
  }
  const parsed = linkImportSchema.safeParse(body);
  if (!parsed.success) {
    return linkErrorResponse(new LinkImportError('link_invalid_url', false));
  }

  try {
    const asset = await importOwnedLinkAsset({
      identity,
      spaceId: conversation.spaceId,
      url: parsed.data.url,
    });
    return jsonResponse({ asset }, { status: 201 });
  } catch (error) {
    if (error instanceof AssetUploadError) {
      return linkErrorResponse(normalizePublicLinkError(error.code));
    }
    return linkErrorResponse(
      new LinkImportError('link_import_unavailable', true),
    );
  }
}
