import 'server-only';

import {
  DrizzleKnowledgeRetrievalRepository,
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

const knowledgeEvidenceSchema = z
  .object({
    candidateId: z.uuid(),
    sourceTitle: z.string().min(1).max(300),
    heading: z.string().max(500).nullable(),
    pageStart: z.number().int().positive().nullable(),
    pageEnd: z.number().int().positive().nullable(),
    text: z.string().min(1).max(16_000),
  })
  .strict();

const retrieveKnowledgeTool = defineTeachingTool({
  name: 'retrieveKnowledge',
  description:
    '从本轮已经冻结的课程资料版本中检索证据。只在回答需要教材事实、定义或引用时调用。',
  exposure: 'model',
  effect: 'read',
  timeoutMs: 3_000,
  inputSchema: z
    .object({
      query: z.string().trim().min(1).max(512),
      limit: z.number().int().min(1).max(8).default(5),
    })
    .strict(),
  outputSchema: z
    .object({
      queryHash: z.string().regex(/^[a-f0-9]{64}$/),
      evidence: z.array(knowledgeEvidenceSchema).max(8),
    })
    .strict(),
  async handler(input, context) {
    if (context.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const repository = new DrizzleKnowledgeRetrievalRepository(getDb());
    await repository.freezeTurnSourceVersions({
      trustedStudentId: context.studentId,
      sessionId: context.sessionId,
      turnId: context.turnId,
    });
    const result = await repository.retrieveFts({
      trustedStudentId: context.studentId,
      sessionId: context.sessionId,
      turnId: context.turnId,
      query: input.query,
      limit: input.limit,
      traceId: context.traceId,
    });
    return {
      queryHash: result.queryHash,
      evidence: result.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        sourceTitle: candidate.sourceTitle,
        heading: candidate.heading,
        pageStart: candidate.pageStart,
        pageEnd: candidate.pageEnd,
        text: candidate.text,
      })),
    };
  },
});

/** 每个 Turn 使用独立 executor，避免跨学生复用进程内 execution cache。 */
export function createTeachingToolExecutor(): TeachingToolExecutor {
  return new TeachingToolExecutor([getStudentStateTool, retrieveKnowledgeTool]);
}
