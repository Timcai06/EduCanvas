import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { jsonError } from '@/server/http/request-security';
import { createWebConnectionService } from '@/server/gateway/connections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 当前 Web 主体的 provider 能力目录与连接列表；外部账号 ID 永不进入响应。 */
export async function GET(): Promise<Response> {
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized', '请先开始对话。');
  try {
    return Response.json(
      await createWebConnectionService().list(identity.studentId),
    );
  } catch {
    return jsonError(503, 'connections_unavailable', '暂时无法读取连接。');
  }
}
