import { z } from 'zod';

/**
 * 学习档案「活动」契约 —— 前后端单一真源（zod 定义，类型由其推导）。
 * 服务端产出后按此 schema 校验再返回，客户端按此 schema 解析，保证全栈链路形状一致；
 * 当前数据源为 mock（见 server/profile/learning-activity-service.ts），接口与链路为正式实现。
 */

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 单日活动量。date 为本地日历日 `YYYY-MM-DD`。
 * count = 当天「判分事件数」：诊断作答 + PRACTICE 答题 + ASSESS 判分型 Canvas 提交。
 * 只数学生产出并被评判的动作（类比 commit），不含被动读讲解，防划水。热力图档位由前端按
 * 相对分位（个人最忙一天）从 count 派生，故 count 保持原始计数，不预置档位。
 */
export const learningActivityDaySchema = z.object({
  date: z.string().regex(DATE_KEY),
  count: z.number().int().nonnegative(),
});

export const learningActivitySchema = z.object({
  /** 覆盖热力图窗口（53 周）的每日活动，含 0，按日期升序。 */
  days: z.array(learningActivityDaySchema),
  totalSessions: z.number().int().nonnegative(),
  activeDays: z.number().int().nonnegative(),
  /** 截至今天或昨天的连续学习天数；更早断掉则为 0。 */
  streakDays: z.number().int().nonnegative(),
  masteryPercent: z.number().min(0).max(100).nullable(),
});

/** GET /api/v1/me/activity 的响应封套。 */
export const learningActivityResponseSchema = z.object({
  activity: learningActivitySchema,
});

export type LearningActivityDay = z.infer<typeof learningActivityDaySchema>;
export type LearningActivity = z.infer<typeof learningActivitySchema>;
export type LearningActivityResponse = z.infer<
  typeof learningActivityResponseSchema
>;
