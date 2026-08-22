import 'server-only';

import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { jsonError } from '@/server/http/request-security';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { ObjectStorageError } from '@educanvas/agent-core';
import { LocalObjectStorage } from '@educanvas/agent-runtime';
import {
  audioOverviewMetadataSchema,
  generatedImageMetadataSchema,
  markdownDocumentContentSchema,
  mindMapContentSchema,
} from '@educanvas/canvas-protocol';
import { webAppContentSchema } from '@educanvas/canvas-protocol/server';
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
      .replace(/[\r\n"'\\/:]/g, '_')
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
    case 'text/markdown':
      return '.md';
    case 'application/json':
      return '.json';
    default:
      return '';
  }
}

function parseRequestedVersion(raw: string | null): number | null {
  if (raw === null) return null;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > 2_147_483_647) return null;
  return value;
}

/**
 * 受控下载面：再次校验身份、当前 Notebook 和 notebook.read，
 * 通过后以 Content-Disposition: attachment 下载文件。
 * Viewer 允许下载；跨 Notebook 和其他用户统一 404。
 * 不向客户端返回存储地址或签名信息。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  const { artifactId } = await params;
  if (!UUID_PATTERN.test(artifactId)) {
    return jsonError(404, 'artifact_not_found');
  }

  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) {
    return jsonError(401, 'unauthorized');
  }

  const url = new URL(request.url);
  const requestedVersion = parseRequestedVersion(
    url.searchParams.get('version'),
  );
  if (requestedVersion === null && url.searchParams.has('version')) {
    return jsonError(404, 'artifact_not_found');
  }

  try {
    const repository = new DrizzlePlatformArtifactRepository();
    const detail = await repository.getArtifactDetail({
      artifactId,
      trustedSubjectId: identity.studentId,
    });

    if (detail.artifact.spaceId !== conversation.spaceId) {
      return jsonError(404, 'artifact_not_found');
    }
    if (detail.artifact.status === 'archived') {
      return jsonError(404, 'artifact_not_found');
    }

    const access = await requireNotebookAccess(getDb(), {
      notebookId: conversation.spaceId,
      trustedSubjectId: identity.studentId,
      requiredPermission: 'notebook.read',
    }).catch(() => null);
    if (!access) {
      return jsonError(404, 'artifact_not_found');
    }

    const selectedVersion =
      requestedVersion !== null
        ? await repository.getVersion({
            artifactId,
            version: requestedVersion,
            trustedSubjectId: identity.studentId,
          })
        : detail.latestVersion;

    if (!selectedVersion) {
      return jsonError(404, 'artifact_not_found');
    }

    const safeTitle = sanitizeFilename(detail.artifact.title);
    const encoder = new TextEncoder();

    if (detail.artifact.kind === 'generated_image') {
      const metadata = generatedImageMetadataSchema.safeParse(
        selectedVersion.metadata,
      );
      if (!metadata.success) {
        return jsonError(404, 'artifact_not_found');
      }
      if (!selectedVersion.objectKey || !selectedVersion.checksum) {
        return jsonError(404, 'artifact_not_found');
      }

      const bytes = await new LocalObjectStorage().readVerified(
        selectedVersion.objectKey,
        selectedVersion.checksum,
      );
      if (bytes.byteLength !== metadata.data.byteSize) {
        return jsonError(503, 'download_integrity_failed');
      }

      const contentType = metadata.data.contentType;
      const filename = `${safeTitle}${extensionForMime(contentType)}`;
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
    }

    if (detail.artifact.kind === 'audio_overview') {
      const metadata = audioOverviewMetadataSchema.safeParse(
        selectedVersion.metadata,
      );
      if (!metadata.success) {
        return jsonError(404, 'artifact_not_found');
      }
      if (!selectedVersion.objectKey || !selectedVersion.checksum) {
        return jsonError(404, 'artifact_not_found');
      }

      const bytes = await new LocalObjectStorage().readVerified(
        selectedVersion.objectKey,
        selectedVersion.checksum,
      );
      if (bytes.byteLength !== metadata.data.byteSize) {
        return jsonError(503, 'download_integrity_failed');
      }

      const contentType = metadata.data.contentType;
      const filename = `${safeTitle}${extensionForMime(contentType)}`;
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
    }

    if (detail.artifact.kind === 'markdown_document') {
      const parsed = markdownDocumentContentSchema.safeParse(
        selectedVersion.content,
      );
      if (!parsed.success) {
        return jsonError(404, 'artifact_not_found');
      }
      const payload = parsed.data.markdown ?? '';
      const filename = `${safeTitle}${extensionForMime('text/markdown')}`;
      const body = encoder.encode(payload);
      return new Response(body, {
        status: 200,
        headers: {
          'cache-control': 'private, no-store',
          'content-type': 'text/markdown; charset=utf-8',
          'content-length': String(body.byteLength),
          'content-disposition': `attachment; filename="${filename}"`,
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
        },
      });
    }

    if (detail.artifact.kind === 'mind_map') {
      const parsed = mindMapContentSchema.safeParse(selectedVersion.content);
      if (!parsed.success) {
        return jsonError(404, 'artifact_not_found');
      }
      const payload = JSON.stringify(parsed.data);
      const body = encoder.encode(payload);
      const filename = `${safeTitle}${extensionForMime('application/json')}`;
      return new Response(body, {
        status: 200,
        headers: {
          'cache-control': 'private, no-store',
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(body.byteLength),
          'content-disposition': `attachment; filename="${filename}"`,
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
        },
      });
    }

    if (detail.artifact.kind === 'web_app') {
      const parsed = webAppContentSchema.safeParse(selectedVersion.content);
      if (!parsed.success) {
        return jsonError(404, 'artifact_not_found');
      }
      /* sourceConversationId 只用于服务端 provenance；导出包不得变成读取
         私有会话或来源的侧信道。代码、hash、预算与诊断仍属于可移植产物。 */
      const exportableContent = {
        ...parsed.data,
        sourceConversationId: undefined,
      };
      const payload = JSON.stringify(exportableContent);
      const body = encoder.encode(payload);
      const filename = `${safeTitle}${extensionForMime('application/json')}`;
      return new Response(body, {
        status: 200,
        headers: {
          'cache-control': 'private, no-store',
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(body.byteLength),
          'content-disposition': `attachment; filename="${filename}"`,
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
        },
      });
    }

    return jsonError(404, 'artifact_not_found');
  } catch (error) {
    if (error instanceof ArtifactOwnershipError) {
      return jsonError(404, 'artifact_not_found');
    }
    if (error instanceof ObjectStorageError) {
      return jsonError(503, 'download_unavailable');
    }
    return jsonError(503, 'download_unavailable');
  }
}
