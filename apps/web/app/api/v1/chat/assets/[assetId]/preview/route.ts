import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { jsonError } from '@/server/http/request-security';
import { DrizzleAssetRepository } from '@educanvas/db';
import { readStoredAssetBytes } from '@/server/assets/asset-storage';
import mammoth from 'mammoth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 预览元数据响应。
 * - PDF: 返回 file URL（客户端用 pdf.js 渲染）
 * - DOCX: 服务端 mammoth 转 HTML 后返回 content
 * - MD/TXT: 返回提取的原始文本 content
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await params;
  if (!UUID_PATTERN.test(assetId)) {
    return jsonError(404, 'asset_not_found', '文件不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) return jsonError(401, 'unauthorized', '请先开始对话。');

  try {
    const repository = new DrizzleAssetRepository();
    const snapshots = await repository.listOwnedSpace({
      ownerSubjectId: identity.studentId,
      spaceId: conversation.spaceId,
    });
    const snapshot = snapshots.find(
      (s) => s.descriptor.assetId === assetId,
    );
    if (!snapshot) {
      return jsonError(404, 'asset_not_found', '文件不存在。');
    }

    const mimeType =
      snapshot.descriptor.mimeType ?? 'application/octet-stream';
    const fileName = snapshot.descriptor.displayName;

    // PDF: 返回 file URL，客户端用 pdf.js 渲染
    if (mimeType === 'application/pdf') {
      return Response.json({
        mimeType,
        fileName,
        fileUrl: `/api/v1/chat/assets/${encodeURIComponent(assetId)}/file`,
      });
    }

    // DOCX: 服务端 mammoth 转 HTML
    if (
      mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml'
    ) {
      if (!snapshot.version?.storageKey) {
        return jsonError(500, 'asset_content_missing', '文件内容缺失。');
      }
      const result = await readStoredAssetBytes(snapshot.version.storageKey);
      if (!result) {
        return jsonError(500, 'asset_content_missing', '文件内容缺失。');
      }
      const htmlResult = await mammoth.convertToHtml({
        buffer: result,
      });
      return Response.json({
        mimeType,
        fileName,
        content: htmlResult.value,
        /** mammoth 产生的警告信息，可用于诊断格式兼容性 */
        warnings: htmlResult.messages.map((m) => m.message),
      });
    }

    // MD / TXT: 返回提取文本
    if (mimeType === 'text/markdown' || mimeType === 'text/plain') {
      if (!snapshot.version?.storageKey) {
        return jsonError(500, 'asset_content_missing', '文件内容缺失。');
      }
      const result = await readStoredAssetBytes(snapshot.version.storageKey);
      if (!result) {
        return jsonError(500, 'asset_content_missing', '文件内容缺失。');
      }
      const content = new TextDecoder('utf-8').decode(result);
      return Response.json({ mimeType, fileName, content });
    }

    // 其他格式（如图片）：暂不支持预览
    return jsonError(415, 'preview_unsupported', '暂不支持此格式的预览。');
  } catch {
    return jsonError(503, 'preview_unavailable', '暂时无法加载预览。');
  }
}
