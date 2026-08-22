import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  AssetPreviewError,
  tombstoneOwnedAsset,
} from '@/server/assets/asset-preview';
import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readLimitedJsonRequest,
} from '@/server/http/json-request';
import { DrizzleAssetRepository } from '@educanvas/db';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ assetId: z.string().uuid() }).strict();

/**
 * 两个动作的授权层级不同，所以分开判别而不是一个可选字段的 PATCH：
 * `set_enabled` 改的是当前成员私有的绑定（notebook.read 即可，viewer 也能改）；
 * `rename` 改的是所有成员共见的展示名（需要 source.write）。
 *
 * mutationId 由客户端生成，用于让重试幂等——网络重发不该把开关又翻回去。
 */
const patchSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('set_enabled'),
      enabled: z.boolean(),
      mutationId: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal('rename'),
      displayName: z.string().trim().min(1).max(300),
    })
    .strict(),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return jsonError(404, 'asset_not_found', '来源不存在。');
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
    return jsonError(400, 'invalid_request', '请求内容不正确。');
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '请求内容不正确。');
  }

  const repository = new DrizzleAssetRepository();
  try {
    if (parsed.data.action === 'rename') {
      const renamed = await repository.renameOwnedAsset({
        ownerSubjectId: identity.studentId,
        spaceId: conversation.spaceId,
        assetId: parsedParams.data.assetId,
        displayName: parsed.data.displayName,
      });
      /* 无权限与不存在统一回 404，不向客户端泄露「存在但你不能改」。 */
      if (!renamed) return jsonError(404, 'asset_not_found', '来源不存在。');
      return jsonResponse({ displayName: parsed.data.displayName });
    }
    const enabled = await repository.setSubjectAssetBinding({
      subjectId: identity.studentId,
      spaceId: conversation.spaceId,
      assetId: parsedParams.data.assetId,
      enabled: parsed.data.enabled,
      mutationId: parsed.data.mutationId,
    });
    if (enabled === null) {
      return jsonError(404, 'asset_not_found', '来源不存在。');
    }
    return jsonResponse({ enabled });
  } catch {
    return jsonError(503, 'asset_update_unavailable', '暂时无法更新来源。');
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return jsonError(404, 'asset_not_found', '来源不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');
  try {
    const deleted = (await tombstoneOwnedAsset({
      identity,
      spaceId: conversation.spaceId,
      assetId: parsed.data.assetId,
    })) as boolean | void;
    if (deleted === false) {
      return jsonError(404, 'asset_not_found', '来源不存在。');
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof AssetPreviewError) {
      return jsonError(error.status, error.code, '来源不存在。');
    }
    return jsonError(503, 'asset_delete_unavailable', '暂时无法删除来源。');
  }
}
