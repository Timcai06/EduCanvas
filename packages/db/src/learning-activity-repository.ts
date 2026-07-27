import { and, avg, count, eq } from 'drizzle-orm';
import { getDb } from './client';
import { learningEvents, lessonSessions, masteryStates } from './schema';

type Database = ReturnType<typeof getDb>;

/** 学习档案只读投影所需的可信数据库事实。 */
export interface LearningActivityFacts {
  gradedActivityAt: readonly string[];
  totalSessions: number;
  meanMasteryScore: number | null;
}

/**
 * 读取单一学习主体的档案事实。
 *
 * 调用边界：`trustedStudentId` 必须来自服务端身份解析，不能接受浏览器传入的主体。
 * 活动只统计服务端写入的 `assessment_graded` 事件；掌握度来自当前投影，不从消息或模型
 * 文本推断。仓储不负责日期窗口和连续天数算法，避免把展示口径混进数据访问层。
 */
export class DrizzleLearningActivityRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async getForStudent(
    trustedStudentId: string,
  ): Promise<LearningActivityFacts> {
    const [activityRows, [sessionCount], [masteryAverage]] = await Promise.all([
      this.database
        .select({ occurredAt: learningEvents.occurredAt })
        .from(learningEvents)
        .where(
          and(
            eq(learningEvents.studentId, trustedStudentId),
            eq(learningEvents.eventType, 'assessment_graded'),
          ),
        ),
      this.database
        .select({ value: count() })
        .from(lessonSessions)
        .where(eq(lessonSessions.studentId, trustedStudentId)),
      this.database
        .select({ value: avg(masteryStates.masteryScore) })
        .from(masteryStates)
        .where(eq(masteryStates.studentId, trustedStudentId)),
    ]);

    return {
      gradedActivityAt: activityRows.map((row) => row.occurredAt.toISOString()),
      totalSessions: sessionCount?.value ?? 0,
      meanMasteryScore:
        masteryAverage?.value === null || masteryAverage?.value === undefined
          ? null
          : Number(masteryAverage.value),
    };
  }
}
