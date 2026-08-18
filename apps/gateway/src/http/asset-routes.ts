import { assetScopeSchema } from '@educanvas/agent-core';
import { gatewayOpaqueIdSchema } from '@educanvas/gateway-core';
import {
  GatewayAssetUploadError,
  MAX_GATEWAY_ASSET_UPLOAD_BYTES,
} from '../asset-upload/asset-upload';
import type { GatewayClientTransport } from './dependencies';
import {
  BoundedMultipartError,
  HANDLED,
  UNHANDLED,
  readBoundedMultipartFormData,
  writeJson,
  type GatewayRouteContext,
  type GatewayRouteResult,
} from './common';

/** multipart 除文件外（boundary/普通字段/头）的固定开销上限。 */
const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024;

/**
 * 桌面资产上传与 ready-wait 轮询路由（DP10）。
 *
 * - `POST /v1/client/assets?notebookId=`：multipart `file`+`scope`，图片落库即 ready，
 *   PDF 落为 processing 由 worker 提取文本后 ready；响应投影见 `gatewayAssetSnapshotSchema`。
 * - `GET /v1/client/assets/:assetId?notebookId=`：返回当前用户在当前 notebook 拥有的资产
 *   快照（含最新版本），供桌面轮询状态。
 *
 * 归属与权限不在此层重复校验：上传/读取都落到 `GatewayAssetUploadService`，
 * 其背后由 repository 事务内 `requireNotebookAccess` 强制。
 */
export async function handleAssetRoutes(
  ctx: GatewayRouteContext,
  client: GatewayClientTransport,
  identity: { userId: string },
): Promise<GatewayRouteResult> {
  const { request, response, url } = ctx;

  if (request.method === 'POST' && url.pathname === '/v1/client/assets') {
    if (!client.assets) {
      writeJson(response, 503, {
        error: { code: 'CLIENT_TRANSPORT_DISABLED' },
      });
      return HANDLED;
    }
    const notebookId = gatewayOpaqueIdSchema.safeParse(
      url.searchParams.get('notebookId'),
    );
    if (!notebookId.success) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
      return HANDLED;
    }
    let form: FormData;
    try {
      form = await readBoundedMultipartFormData(
        request,
        MAX_GATEWAY_ASSET_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES,
      );
    } catch (error) {
      if (error instanceof BoundedMultipartError) {
        writeJson(response, error.code === 'multipart_too_large' ? 413 : 400, {
          error: {
            code:
              error.code === 'multipart_too_large'
                ? 'FILE_TOO_LARGE'
                : 'INVALID_REQUEST',
          },
        });
        return HANDLED;
      }
      throw error;
    }
    const file = form.get('file');
    const scope = form.get('scope');
    if (!(file instanceof File) || !assetScopeSchema.safeParse(scope).success) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
      return HANDLED;
    }
    try {
      const snapshot = await client.assets.upload({
        trustedSubjectId: identity.userId,
        notebookId: notebookId.data,
        file,
        scope: scope as 'turn' | 'space',
      });
      writeJson(response, 201, {
        descriptor: snapshot.descriptor,
        version: snapshot.version,
      });
    } catch (error) {
      if (error instanceof GatewayAssetUploadError) {
        writeJson(response, error.status, { error: { code: error.code } });
        return HANDLED;
      }
      throw error;
    }
    return HANDLED;
  }

  const assetMatch =
    request.method === 'GET'
      ? url.pathname.match(/^\/v1\/client\/assets\/([^/]+)$/)
      : null;
  if (assetMatch) {
    if (!client.assets) {
      writeJson(response, 503, {
        error: { code: 'CLIENT_TRANSPORT_DISABLED' },
      });
      return HANDLED;
    }
    const notebookId = gatewayOpaqueIdSchema.safeParse(
      url.searchParams.get('notebookId'),
    );
    let decodedAssetId: string | null = null;
    try {
      decodedAssetId = decodeURIComponent(assetMatch[1]!);
    } catch {
      // 非法 percent encoding 与其他无效选择器使用同一个 400 形状。
    }
    const assetId = gatewayOpaqueIdSchema.safeParse(decodedAssetId);
    if (!notebookId.success || !assetId.success) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
      return HANDLED;
    }
    try {
      const snapshot = await client.assets.get({
        trustedSubjectId: identity.userId,
        notebookId: notebookId.data,
        assetId: assetId.data,
      });
      writeJson(response, 200, {
        descriptor: snapshot.descriptor,
        version: snapshot.version,
      });
    } catch (error) {
      if (error instanceof GatewayAssetUploadError) {
        writeJson(response, error.status, { error: { code: error.code } });
        return HANDLED;
      }
      throw error;
    }
    return HANDLED;
  }

  return UNHANDLED;
}
