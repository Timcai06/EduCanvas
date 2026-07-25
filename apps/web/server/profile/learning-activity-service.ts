import 'server-only';

import { DrizzleLearningActivityRepository } from '@educanvas/db';
import type { LearningActivity } from '@/features/profile/activity-contract';
import { buildLearningActivity } from './learning-activity';

/**
 * 学习活动服务层：档案热力图与统计的唯一数据入口，HTTP 路由与 Server Component 都经此取数。
 *
 * 主体只能来自服务端身份解析。无主体时返回显式空投影；有主体时仅消费 PostgreSQL 中
 * `assessment_graded` 可信事件、真实 Session 数和当前掌握度投影，不从消息文本推断。
 */
const activities = new DrizzleLearningActivityRepository();

export async function getLearningActivity(
  trustedStudentId: string | null,
  now: Date = new Date(),
): Promise<LearningActivity> {
  if (!trustedStudentId) {
    return buildLearningActivity({
      sessionActivityAt: [],
      masteryPercent: null,
      totalSessions: 0,
      now,
    });
  }

  const facts = await activities.getForStudent(trustedStudentId);
  return buildLearningActivity({
    sessionActivityAt: facts.gradedActivityAt,
    masteryPercent:
      facts.meanMasteryScore === null
        ? null
        : Math.round(facts.meanMasteryScore * 100),
    totalSessions: facts.totalSessions,
    now,
  });
}
