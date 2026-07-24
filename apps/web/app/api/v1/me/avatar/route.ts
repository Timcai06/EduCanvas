import { readRegisteredSessionIdentity } from '@/server/auth/session';
import { WebAccountRepository } from '@/server/auth/account-repository';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import {
  readStoredAssetBytes,
  removeStoredAsset,
  removeStoredAssetByKey,
  storeAssetBytes,
} from '@/server/assets/asset-storage';
import {
  BoundedMultipartError,
  readBoundedMultipartFormData,
} from '@/server/http/bounded-multipart';
import {
  AvatarUploadError,
  avatarUploadErrorMessage,
  detectAvatarImage,
} from '@/server/profile/avatar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_AVATAR_MULTIPART_BYTES = 2 * 1024 * 1024 + 64 * 1024;

export async function GET(): Promise<Response> {
  const identity = await readRegisteredSessionIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先登录。');
  const avatar = await new WebAccountRepository().getAvatar(identity.userId);
  if (!avatar) return jsonError(404, 'avatar_not_found', '头像不存在。');
  const bytes = await readStoredAssetBytes(avatar.objectKey);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': avatar.mimeType,
      'cache-control': 'private, max-age=60',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  const identity = await readRegisteredSessionIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先登录。');
  let stored: Awaited<ReturnType<typeof storeAssetBytes>> | null = null;
  try {
    const form = await readBoundedMultipartFormData(
      request,
      MAX_AVATAR_MULTIPART_BYTES,
    );
    const file = form.get('avatar');
    if (!(file instanceof File)) {
      return jsonError(400, 'invalid_avatar', '请选择头像文件。');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectAvatarImage(bytes);
    const repository = new WebAccountRepository();
    const previousAvatar = await repository.getAvatar(identity.userId);
    stored = await storeAssetBytes({
      ownerSubjectId: identity.userId,
      bytes,
      extension: detected.extension,
    });
    await repository.updateAvatar({
      userId: identity.userId,
      objectKey: stored.storageKey,
      mimeType: detected.mimeType,
    });
    if (
      previousAvatar?.objectKey &&
      previousAvatar.objectKey !== stored.storageKey
    ) {
      await removeStoredAssetByKey(previousAvatar.objectKey).catch((error) => {
        console.warn('[avatar] 旧头像对象清理失败', {
          code: error instanceof Error ? error.message : 'unknown',
        });
      });
    }
    return Response.json({ avatarAvailable: true });
  } catch (error) {
    if (stored) await removeStoredAsset(stored).catch(() => undefined);
    if (error instanceof BoundedMultipartError) {
      return error.code === 'multipart_too_large'
        ? jsonError(413, 'avatar_too_large', '头像不能超过 2MB。')
        : jsonError(415, 'invalid_avatar', '上传必须使用表单格式。');
    }
    if (error instanceof AvatarUploadError) {
      return jsonError(
        error.code === 'avatar_too_large' ? 413 : 415,
        error.code,
        avatarUploadErrorMessage(error),
      );
    }
    return jsonError(503, 'avatar_unavailable', '暂时无法上传头像。');
  }
}
