import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { jsonError } from '@/server/http/request-security';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { ObjectStorageError } from '@educanvas/agent-core';
import { LocalObjectStorage } from '@educanvas/agent-runtime';
import { generatedImageMetadataSchema } from '@educanvas/canvas-protocol';
import {
  ArtifactOwnershipError,
  DrizzlePlatformArtifactRepository,
} from '@educanvas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 私有图像读取面：先按主体取版本，再对完整对象做 SHA-256 校验后响应。
 *
 * 与音频面不同，这里不支持 Range：生成图像上限只有几 MB，一次性完整校验比
 * 分片更简单也更难出错，分片会让「整对象校验和」失去意义。
 *
 * `content-type` 只来自落库 metadata 的白名单枚举，配合 `nosniff` 保证浏览器
 * 不会按内容重新猜测类型；objectKey 与 checksum 不出现在任何响应里。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  const { artifactId } = await params;
  if (!UUID_PATTERN.test(artifactId)) {
    return jsonError(404, 'artifact_not_found', '图像产物不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation) {
    return jsonError(401, 'unauthorized', '请先开始对话。');
  }

  try {
    const detail =
      await new DrizzlePlatformArtifactRepository().getArtifactDetail({
        artifactId,
        trustedSubjectId: identity.studentId,
      });
    if (detail.artifact.spaceId !== conversation.spaceId) {
      return jsonError(404, 'artifact_not_found', '图像产物不存在。');
    }
    if (detail.artifact.status === 'archived') {
      return jsonError(404, 'artifact_not_found', '图像产物不存在。');
    }
    const version = detail.latestVersion;
    const metadata = generatedImageMetadataSchema.safeParse(version?.metadata);
    if (
      detail.artifact.kind !== 'generated_image' ||
      !version?.objectKey ||
      !version.checksum ||
      !metadata.success
    ) {
      return jsonError(404, 'artifact_not_found', '图像产物不存在。');
    }
    const bytes = await new LocalObjectStorage().readVerified(
      version.objectKey,
      version.checksum,
    );
    if (bytes.byteLength !== metadata.data.byteSize) {
      return jsonError(503, 'image_integrity_failed', '图像完整性校验失败。');
    }

    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    return new Response(body.buffer, {
      status: 200,
      headers: {
        'cache-control': 'private, no-store',
        'content-type': metadata.data.contentType,
        'content-length': String(body.byteLength),
        'x-content-type-options': 'nosniff',
        /* 生成图像永远只作为图片下发，不允许被当作页面在同源下打开。 */
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof ArtifactOwnershipError) {
      return jsonError(404, 'artifact_not_found', '图像产物不存在。');
    }
    if (error instanceof ObjectStorageError) {
      return jsonError(503, 'image_unavailable', '暂时无法读取图像。');
    }
    return jsonError(503, 'image_unavailable', '暂时无法读取图像。');
  }
}
