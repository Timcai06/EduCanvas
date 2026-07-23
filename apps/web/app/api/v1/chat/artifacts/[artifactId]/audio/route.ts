import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { jsonError } from '@/server/http/request-security';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { ObjectStorageError } from '@educanvas/agent-core';
import { LocalObjectStorage } from '@educanvas/agent-runtime';
import { audioOverviewMetadataSchema } from '@educanvas/canvas-protocol';
import {
  ArtifactOwnershipError,
  DrizzlePlatformArtifactRepository,
} from '@educanvas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRange(value: string | null, total: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return undefined;
  const rawStart = match[1];
  const rawEnd = match[2];
  if (!rawStart && !rawEnd) return undefined;
  let start: number;
  let end: number;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined;
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : total - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= total ||
    end < start
  ) {
    return undefined;
  }
  return { start, end: Math.min(end, total - 1) };
}

/** 私有音频读取面：先按主体取版本，再对完整对象做 SHA-256 校验后响应。 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  const { artifactId } = await params;
  if (!UUID_PATTERN.test(artifactId)) {
    return jsonError(404, 'artifact_not_found', '音频产物不存在。');
  }
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  if (!(await loadOwnedGeneralConversation(identity))) {
    return jsonError(401, 'unauthorized', '请先开始对话。');
  }

  try {
    const detail =
      await new DrizzlePlatformArtifactRepository().getArtifactDetail({
        artifactId,
        trustedSubjectId: identity.studentId,
      });
    const version = detail.latestVersion;
    const metadata = audioOverviewMetadataSchema.safeParse(version?.metadata);
    if (
      detail.artifact.kind !== 'audio_overview' ||
      !version?.objectKey ||
      !version.checksum ||
      !metadata.success
    ) {
      return jsonError(404, 'artifact_not_found', '音频产物不存在。');
    }
    const bytes = await new LocalObjectStorage().readVerified(
      version.objectKey,
      version.checksum,
    );
    if (bytes.byteLength !== metadata.data.byteSize) {
      return jsonError(503, 'audio_integrity_failed', '音频完整性校验失败。');
    }

    const range = parseRange(request.headers.get('range'), bytes.byteLength);
    if (range === undefined) {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${bytes.byteLength}` },
      });
    }
    const body = range ? bytes.slice(range.start, range.end + 1) : bytes;
    const headers = new Headers({
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-store',
      'content-type': metadata.data.contentType,
      'content-length': String(body.byteLength),
      'x-content-type-options': 'nosniff',
    });
    if (range) {
      headers.set(
        'content-range',
        `bytes ${range.start}-${range.end}/${bytes.byteLength}`,
      );
    }
    const responseBody = new Uint8Array(body.byteLength);
    responseBody.set(body);
    return new Response(responseBody.buffer, {
      status: range ? 206 : 200,
      headers,
    });
  } catch (error) {
    if (error instanceof ArtifactOwnershipError) {
      return jsonError(404, 'artifact_not_found', '音频产物不存在。');
    }
    if (error instanceof ObjectStorageError) {
      return jsonError(503, 'audio_unavailable', '暂时无法读取音频。');
    }
    return jsonError(503, 'audio_unavailable', '暂时无法读取音频。');
  }
}
