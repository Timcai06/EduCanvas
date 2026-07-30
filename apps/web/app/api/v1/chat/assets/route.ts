import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import {
  AssetUploadError,
  listOwnedSpaceAssetsPage,
  uploadOwnedAssetToSpace,
} from '@/server/assets/asset-upload';
import {
  assetUploadErrorResponse,
  parseAssetUploadRequest,
} from '@/server/assets/asset-upload-http';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import {
  encodeTemporalCursor,
  PaginationRequestError,
  parseListPagination,
} from '@/server/http/pagination';
import { projectOwnedSourceResources } from '@/server/canvas/resource-access';
import { DrizzleAssetRepository, type AssetSnapshot } from '@educanvas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 成员从未切换过的来源没有绑定事实，此时给出默认值。
 *
 * 默认值放在服务端而不是浏览器：它决定下一轮对话真正带上哪些资料，
 * 两端各算一次迟早会漂移。默认只对「已就绪的笔记本长期来源」为真——
 * turn 级附件属于单轮，不该在后续对话里自动复活。
 */
function resolveEnabled(
  asset: AssetSnapshot,
  bindings: ReadonlyMap<string, boolean>,
): boolean {
  const bound = bindings.get(asset.descriptor.assetId);
  if (bound !== undefined) return bound;
  return (
    asset.descriptor.scope === 'space' && asset.descriptor.status === 'ready'
  );
}

async function loadContext() {
  const identity = await readAnonymousIdentity();
  if (!identity) return null;
  const conversation = await loadOwnedGeneralConversation(identity);
  return conversation ? { identity, conversation } : null;
}

export async function GET(request: Request): Promise<Response> {
  const context = await loadContext();
  if (!context) return jsonError(401, 'unauthorized', '请先开始对话。');
  try {
    const pagination = parseListPagination(request);
    const page = await listOwnedSpaceAssetsPage(
      context.identity,
      context.conversation.spaceId,
      pagination,
    );
    /* 与预览、产物详情端点同一约定：既有投影字段保持不变，额外附加 canvasResource，
       让 Studio 直接读服务端授权过的动作与状态，而不是在浏览器里猜。 */
    const [resources, bindings] = await Promise.all([
      projectOwnedSourceResources({
        identity: context.identity,
        notebookId: context.conversation.spaceId,
        snapshots: page.items,
      }),
      new DrizzleAssetRepository().listSubjectAssetBindings({
        subjectId: context.identity.studentId,
        spaceId: context.conversation.spaceId,
      }),
    ]);
    return jsonResponse({
      assets: page.items.map((asset) => ({
        ...asset,
        canvasResource: resources.get(asset.descriptor.assetId) ?? null,
        enabled: resolveEnabled(asset, bindings),
      })),
      page: { nextCursor: encodeTemporalCursor(page.nextCursor) },
    });
  } catch (error) {
    if (error instanceof PaginationRequestError) {
      return jsonError(400, error.code, '分页参数不正确。');
    }
    return jsonError(503, 'asset_list_unavailable', '暂时无法读取资料。');
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const context = await loadContext();
  if (!context) return jsonError(401, 'unauthorized', '请先开始对话。');
  try {
    const upload = await parseAssetUploadRequest(request);
    if (upload instanceof Response) return upload;
    const asset = await uploadOwnedAssetToSpace({
      identity: context.identity,
      spaceId: context.conversation.spaceId,
      ...upload,
    });
    return jsonResponse({ asset }, { status: 201 });
  } catch (error) {
    if (error instanceof AssetUploadError) {
      return assetUploadErrorResponse(error);
    }
    return jsonError(503, 'asset_upload_unavailable', '文件上传暂时不可用。');
  }
}
