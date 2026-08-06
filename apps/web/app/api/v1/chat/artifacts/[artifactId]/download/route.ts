import 'server-only';

import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { jsonError } from '@/server/http/request-security';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { ObjectStorageError } from '@educanvas/agent-core';
import { LocalObjectStorage } from '@educanvas/agent-runtime';
import {
  audioOverviewMetadataSchema,
  generatedImageMetadataSchema,
} from '@educanvas/canvas-protocol';
import {
  ArtifactOwnershipError,
  DrizzlePlatformArtifactRepository,
  requireNotebookAccess,
} from '@educanvas/db';
import { getDb } from '@educanvas/db/internal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 过滤文件名中的 CR/LF、引号和路径分隔符，并移除非 ASCII 字符，
 * 确保 Content-Disposition 安全。保留字母、数字、连字符、下划线和点。
 */
function sanitizeFilename(raw: string): string {
  return (
    raw
      .replace(/[\r\n"'/\\:]/g, '_')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 128) || 'download'
  );
}

function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'audio/mpeg':
      return '.mp3';
    default:
      return '';
  }
}

/**
 * 受控下载面：再次校验身份、当前 Notebook 和 notebook.read，
 * 通过后以 Content-Disposition: attachment 下载文件。
 * Viewer 允许下载；跨 Notebook 和其他用户统一 404。
 * 不向客户端返回存储地址或签名信息。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  const { artifactId } = await params;
  if (!UUID_PATTERN.test(artifactId)) {
    return jsonError(404, 'artifact_not_found', '产物不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) {
    return jsonError(401, 'unauthorized', '请先开始对话。');
  }

  try {
    const repository = new DrizzlePlatformArtifactRepository();
    const detail = await repository.getArtifactDetail({
      artifactId,
      trustedSubjectId: identity.studentId,
    });
    if (detail.artifact.spaceId !== conversation.spaceId) {
      return jsonError(404, 'artifact_not_found', '产物不存在。');
    }
    if (detail.artifact.status === 'archived') {
      return jsonError(404, 'artifact_not_found', '产物不存在。');
    }

    const access = await requireNotebookAccess(getDb(), {
      notebookId: conversation.spaceId,
      trustedSubjectId: identity.studentId,
      requiredPermission: 'notebook.read',
    }).catch(() => null);
    if (!access) {
      return jsonError(404, 'artifact_not_found', '产物不存在。');
    }

    const version = detail.latestVersion;
    if (!version?.objectKey || !version.checksum) {
      return jsonError(404, 'artifact_not_found', '产物不存在。');
    }

    let contentType: string;
    let expectedByteSize: number;
    let title: string;
    if (detail.artifact.kind === 'generated_image') {
      const metadata = generatedImageMetadataSchema.safeParse(version.metadata);
      if (!metadata.success) {
        return jsonError(404, 'artifact_not_found', '产物不存在。');
      }
      contentType = metadata.data.contentType;
      expectedByteSize = metadata.data.byteSize;
      title = detail.artifact.title;
    } else if (detail.artifact.kind === 'audio_overview') {
      const metadata = audioOverviewMetadataSchema.safeParse(version.metadata);
      if (!metadata.success) {
        return jsonError(404, 'artifact_not_found', '产物不存在。');
      }
      contentType = metadata.data.contentType;
      expectedByteSize = metadata.data.byteSize;
      title = detail.artifact.title;
    } else {
      return jsonError(404, 'artifact_not_found', '产物不支持下载。');
    }

    const bytes = await new LocalObjectStorage().readVerified(
      version.objectKey,
      version.checksum,
    );
    if (bytes.byteLength !== expectedByteSize) {
      return jsonError(
        503,
        'download_integrity_failed',
        '下载内容完整性校验失败。',
      );
    }

    const ext = extensionForMime(contentType);
    const safeTitle = sanitizeFilename(title);
    const filename = `${safeTitle}${ext}`;

    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    return new Response(body.buffer, {
      status: 200,
      headers: {
        'cache-control': 'private, no-store',
        'content-type': contentType,
        'content-length': String(body.byteLength),
        'content-disposition': `attachment; filename="${filename}"`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof ArtifactOwnershipError) {
      return jsonError(404, 'artifact_not_found', '产物不存在。');
    }
    if (error instanceof ObjectStorageError) {
      return jsonError(503, 'download_unavailable', '暂时无法下载产物。');
    }
    return jsonError(503, 'download_unavailable', '暂时无法下载产物。');
  }
}
