import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  bootstrapCompensator,
  learningSessions,
  studyPlans,
  loadOwnedStudyContext,
} = vi.hoisted(() => ({
  bootstrapCompensator: {
    discardUnplannedSession: vi.fn(),
  },
  learningSessions: {
    startNew: vi.fn(),
    restoreArchivedIfNoActiveSession: vi.fn(),
  },
  studyPlans: {
    bootstrap: vi.fn(),
  },
  loadOwnedStudyContext: vi.fn(),
}));

vi.mock('@educanvas/db', () => ({
  DrizzleChatRepository: vi.fn(function () {
    return {};
  }),
  DrizzleKnowledgeRetrievalRepository: vi.fn(function () {
    return {};
  }),
  DrizzleLearningSessionRepository: vi.fn(function () {
    return learningSessions;
  }),
  DrizzleSessionRepository: vi.fn(function () {
    return {};
  }),
  DrizzleStudyBootstrapCompensator: vi.fn(function () {
    return bootstrapCompensator;
  }),
  DrizzleStudyPlanRepository: vi.fn(function () {
    return studyPlans;
  }),
  getDb: vi.fn(),
}));

vi.mock('../study/study-service', () => ({
  loadOwnedStudyContext,
}));

vi.mock('./teaching-runtime', () => ({
  gradeCanvasSubmissionService: vi.fn(),
  progressTeachingStateService: vi.fn(),
}));

import { startNewAnonymousLesson } from './learning-session';

const identity = {
  token: 'token',
  studentId: `anon:v1:${'d'.repeat(64)}`,
};

const course = {
  courseSlug: 'math-foundations',
  courseVersion: 1,
  gradeBand: 'middle',
  title: '数学基础',
  objectives: [
    {
      objectiveKey: 'fraction-addition',
      knowledgeNodeId: 'fraction-addition',
      title: '分数加法',
    },
  ],
};

const context = {
  sessionId: 'old-session',
  course,
  plan: {
    profile: {
      declaredByUserId: identity.studentId,
      ageBand: '10-12',
      gradeBand: 'middle',
      declarationSource: 'self_declared',
      preferences: {},
    },
    goal: {
      desiredOutcome: '掌握分数加法',
      gradeBand: 'middle',
      courseSlug: course.courseSlug,
    },
  },
};

describe('startNewAnonymousLesson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadOwnedStudyContext.mockResolvedValue(context);
    learningSessions.startNew.mockResolvedValue({
      sessionId: 'new-session',
      created: true,
    });
    learningSessions.restoreArchivedIfNoActiveSession.mockResolvedValue(true);
    studyPlans.bootstrap.mockResolvedValue({});
    bootstrapCompensator.discardUnplannedSession.mockResolvedValue(true);
  });

  it('Goal写入失败且删除新Notebook后恢复旧Session并保留原始错误', async () => {
    const failure = new Error('goal insert failed');
    studyPlans.bootstrap.mockRejectedValue(failure);

    await expect(startNewAnonymousLesson(identity)).rejects.toBe(failure);
    expect(bootstrapCompensator.discardUnplannedSession).toHaveBeenCalledOnce();
    expect(bootstrapCompensator.discardUnplannedSession).toHaveBeenCalledWith({
      trustedStudentId: identity.studentId,
      sessionId: 'new-session',
    });
    expect(
      bootstrapCompensator.discardUnplannedSession,
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: context.sessionId }),
    );
    expect(
      learningSessions.restoreArchivedIfNoActiveSession,
    ).toHaveBeenCalledOnce();
    expect(
      learningSessions.restoreArchivedIfNoActiveSession,
    ).toHaveBeenCalledWith(
      {
        studentId: identity.studentId,
        gradeBand: context.plan.goal.gradeBand,
        courseSlug: context.plan.goal.courseSlug,
        knowledgeNodeId: context.course.objectives[0]!.knowledgeNodeId,
      },
      context.sessionId,
    );
  });

  it('并发请求已绑定Goal而补偿器拒绝删除时仍抛出原始错误', async () => {
    const failure = new Error('goal insert raced');
    studyPlans.bootstrap.mockRejectedValue(failure);
    bootstrapCompensator.discardUnplannedSession.mockResolvedValue(false);

    await expect(startNewAnonymousLesson(identity)).rejects.toBe(failure);
    expect(bootstrapCompensator.discardUnplannedSession).toHaveBeenCalledOnce();
    expect(
      learningSessions.restoreArchivedIfNoActiveSession,
    ).not.toHaveBeenCalled();
  });

  it('Goal与清理都失败时保留两项失败原因', async () => {
    const goalFailure = new Error('goal insert failed');
    const cleanupFailure = new Error('cleanup failed');
    studyPlans.bootstrap.mockRejectedValue(goalFailure);
    bootstrapCompensator.discardUnplannedSession.mockRejectedValue(
      cleanupFailure,
    );

    const promise = startNewAnonymousLesson(identity);

    await expect(promise).rejects.toMatchObject({
      message: '新学习记录创建失败且新建Notebook补偿失败',
      errors: [goalFailure, cleanupFailure],
    });
    expect(
      learningSessions.restoreArchivedIfNoActiveSession,
    ).not.toHaveBeenCalled();
  });

  it('Goal失败且清理成功但旧Session恢复失败时保留两项失败原因', async () => {
    const goalFailure = new Error('goal insert failed');
    const resumeFailure = new Error('resume failed');
    studyPlans.bootstrap.mockRejectedValue(goalFailure);
    learningSessions.restoreArchivedIfNoActiveSession.mockRejectedValue(
      resumeFailure,
    );

    const promise = startNewAnonymousLesson(identity);

    await expect(promise).rejects.toMatchObject({
      message: '新学习记录创建失败且旧Notebook恢复失败',
      errors: [goalFailure, resumeFailure],
    });
  });
});
