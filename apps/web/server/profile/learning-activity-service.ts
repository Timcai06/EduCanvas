import 'server-only';

import type { LearningActivity } from '@/features/profile/activity-contract';
import { buildMockLearningActivity } from './learning-activity';

/**
 * 学习活动服务层：档案热力图与统计的唯一数据入口，HTTP 路由与 Server Component 都经此取数。
 *
 * ⚠️ 当前为 MOCK 数据源：按 seed（学习主体 id）确定性伪造活动（见 buildMockLearningActivity）。
 * 接口、契约校验与全栈链路均为正式实现——接入真实数据时只把这里换成真实查询即可，
 * 路由 / 契约 / 组件均无需改动。异步签名为将来落库预留。
 * TODO(后端线): count 的正式定义为「判分事件数」——按天聚合 诊断作答 + PRACTICE 答题
 * + ASSESS 判分型 Canvas 提交（只数被评判的产出，不含读讲解），替换 mock。
 */
export async function getLearningActivity(
  seed: string,
  now: Date = new Date(),
): Promise<LearningActivity> {
  return buildMockLearningActivity(seed, now);
}
