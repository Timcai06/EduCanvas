import { learningActivityResponseSchema } from '@/features/profile/activity-contract';
import { jsonError, jsonResponse } from '@/server/http/request-security';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { getLearningActivity } from '@/server/profile/learning-activity-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/me/activity —— 当前学习主体的档案活动（热力图 + 统计）。
 * 身份取匿名学习主体（学习进度即挂在其上），不接受 URL 指定他人主体。产出按契约 schema
 * 校验后返回，形状违约即视为服务端故障而非静默放行；没有主体时诚实返回空投影。
 * 服务/Repository 异常返回 activity_unavailable，不泄露原始错误信息。
 */
export async function GET(): Promise<Response> {
  try {
    const identity = await readAnonymousIdentity();
    const activity = await getLearningActivity(identity?.studentId ?? null);

    const parsed = learningActivityResponseSchema.safeParse({ activity });
    if (!parsed.success) {
      return jsonError(500, 'activity_contract_violation');
    }

    return jsonResponse(parsed.data, {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch {
    // 不泄露原始异常信息：不包含 error.message、stack、SQL、主体 ID
    return jsonError(500, 'activity_unavailable');
  }
}
