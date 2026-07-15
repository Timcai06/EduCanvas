import 'server-only';

import {
  DrizzleMasteryRepository,
  DrizzleSessionRepository,
  getDb,
} from '@educanvas/db';
import { teachingStateSchema } from '@educanvas/teaching-core';
import {
  TeachingToolExecutor,
  defineTeachingTool,
} from '@educanvas/teaching-runtime';
import { z } from 'zod';

const studentStateOutputSchema = z
  .object({
    state: teachingStateSchema,
    knowledgeNodeId: z.string().nullable(),
    mastery: z
      .object({
        masteryScore: z.number().min(0).max(1),
        attemptCount: z.number().int().nonnegative(),
        correctCount: z.number().int().nonnegative(),
        hintCount: z.number().int().nonnegative(),
        activeMisconceptions: z.array(z.string()),
      })
      .strict()
      .nullable(),
  })
  .strict();

const getStudentStateTool = defineTeachingTool({
  name: 'getStudentState',
  description:
    '读取当前学生在本课知识点的可信教学状态与聚合学习进度，不包含身份信息。',
  exposure: 'model',
  effect: 'read',
  timeoutMs: 2_000,
  inputSchema: z.object({}).strict(),
  outputSchema: studentStateOutputSchema,
  async handler(_input, context) {
    if (context.signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const database = getDb();
    const sessions = new DrizzleSessionRepository(database);
    const mastery = new DrizzleMasteryRepository(database);
    const session = await sessions.getById(context.sessionId);
    if (
      !session ||
      session.studentId !== context.studentId ||
      session.knowledgeNodeId !== context.knowledgeNodeId
    ) {
      throw new Error('trusted_session_changed');
    }

    const masterySnapshot = session.knowledgeNodeId
      ? await mastery.get(context.studentId, session.knowledgeNodeId)
      : null;
    return {
      state: session.state,
      knowledgeNodeId: session.knowledgeNodeId,
      mastery: masterySnapshot
        ? {
            masteryScore: masterySnapshot.masteryScore,
            attemptCount: masterySnapshot.attemptCount,
            correctCount: masterySnapshot.correctCount,
            hintCount: masterySnapshot.hintCount,
            activeMisconceptions: [...masterySnapshot.activeMisconceptions],
          }
        : null,
    };
  },
});

/** 每个 Turn 使用独立 executor，避免跨学生复用进程内 execution cache。 */
export function createTeachingToolExecutor(): TeachingToolExecutor {
  return new TeachingToolExecutor([getStudentStateTool]);
}
