import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  AssetUploadError,
  importOwnedLinkAsset,
} from '@/server/assets/asset-upload';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readLimitedJsonRequest,
} from '@/server/http/json-request';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const linkImportSchema = z
  .object({ url: z.string().trim().min(8).max(1024) })
  .strict();

function linkErrorMessage(code: string): string {
  switch (code) {
    case 'link_invalid_url':
      return '链接格式不正确，请输入完整的 http(s) 地址。';
    case 'link_blocked_host':
      return '这个地址不允许访问。';
    case 'link_too_large':
      return '网页太大，暂时无法导入。';
    case 'link_unsupported_content':
      return '这个页面没有可提取的文字内容。';
    default:
      return '暂时无法读取这个网页，请稍后重试。';
  }
}

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
    return jsonError(400, 'invalid_request', '链接参数不正确。');
  }

  try {
    const asset = await importOwnedLinkAsset({
      identity,
      spaceId: conversation.spaceId,
      url: parsed.data.url,
    });
    return Response.json({ asset }, { status: 201 });
  } catch (error) {
    if (error instanceof AssetUploadError) {
      return jsonError(error.status, error.code, linkErrorMessage(error.code));
    }
    return jsonError(503, 'link_import_unavailable', '暂时无法导入链接。');
  }
}
