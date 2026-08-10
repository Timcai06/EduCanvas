import { experienceModeSelectionSchema } from '@/features/experience-mode/experience-mode-contract';
import {
  isTrustedSameOriginWrite,
  jsonError,
} from '@/server/http/request-security';
import {
  JsonRequestValidationError,
  jsonRequestErrorResponse,
  readLimitedJsonRequest,
} from '@/server/http/json-request';
import { writeExperienceMode } from '@/server/experience-mode';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedSameOriginWrite(request)) {
    return jsonError(403, 'forbidden_origin', '请求来源不受信任。');
  }
  let raw: unknown;
  try {
    raw = await readLimitedJsonRequest(request, { maxBytes: 512 });
  } catch (error) {
    return error instanceof JsonRequestValidationError
      ? jsonRequestErrorResponse(error)
      : jsonError(400, 'invalid_request', '模式选择格式不正确。');
  }
  const parsed = experienceModeSelectionSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', '模式选择格式不正确。');
  }
  await writeExperienceMode(parsed.data.mode);
  return Response.json(
    { mode: parsed.data.mode },
    { headers: { 'cache-control': 'no-store' } },
  );
}
