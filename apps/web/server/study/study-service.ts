import 'server-only';

import {
  DrizzleLearningSessionRepository,
  DrizzleSessionRepository,
  DrizzleStudyBootstrapCompensator,
  DrizzleStudyDiagnosticRepository,
  DrizzleStudyPlanRepository,
  getDb,
  type StudyPlanSnapshot,
} from '@educanvas/db';
import {
  diagnosticSubmissionSchema,
  gradeDiagnostic,
  learnerProfileDeclarationSchema,
  projectPublicDiagnostic,
  type StudyCourseDefinition,
} from '@educanvas/teaching-core';
import { z } from 'zod';
import type {
  CreateStudyPlanInputDTO,
  StudyDiagnosticDTO,
  SubmitDiagnosticInputDTO,
} from '@/features/learning/learning-contracts';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { demoLesson } from '../teaching/demo-lesson';
import { getTrustedStudyCourse, getTrustedStudyCourseForGoal } from './catalog';

const studyPlans = new DrizzleStudyPlanRepository();
const diagnostics = new DrizzleStudyDiagnosticRepository();
const learningSessions = new DrizzleLearningSessionRepository();
const bootstrapCompensator = new DrizzleStudyBootstrapCompensator();

const createStudyPlanInputSchema = z
  .object({
    ageBand: learnerProfileDeclarationSchema.shape.ageBand,
    gradeBand: learnerProfileDeclarationSchema.shape.gradeBand,
    // school_asserted 预留给未来已验证学校身份，匿名 Web 不能自授该来源。
    declarationSource: z.enum(['self_declared', 'guardian_declared']),
    desiredOutcome: z.string().trim().min(1).max(500),
    preferences: learnerProfileDeclarationSchema.shape.preferences,
  })
  .strict();

export interface OwnedStudyContext {
  plan: StudyPlanSnapshot;
  course: StudyCourseDefinition;
  sessionId: string;
}

export type StudyPageState =
  | { kind: 'setup' }
  | { kind: 'diagnostic'; data: StudyDiagnosticDTO }
  | { kind: 'workspace'; context: OwnedStudyContext };

function courseForPlan(plan: StudyPlanSnapshot): StudyCourseDefinition | null {
  return getTrustedStudyCourseForGoal({
    gradeBand: plan.goal.gradeBand,
    courseSlug: plan.goal.courseSlug,
    courseVersion: plan.goal.courseVersion,
  });
}

/**
 * 用当前活动 Session 反查它所属的 Notebook Goal，避免恢复旧会话后仍误用
 * 另一个 Notebook 的最新 Goal。找不到受信课程版本时诚实返回 null。
 */
export async function loadOwnedStudyContext(
  identity: AnonymousIdentity,
): Promise<OwnedStudyContext | null> {
  const latestPlan = await studyPlans.getActiveForStudent(identity.studentId);
  if (!latestPlan) return null;
  const latestCourse = courseForPlan(latestPlan);
  if (!latestCourse) return null;
  const currentSession = await learningSessions.getCurrentOwned({
    studentId: identity.studentId,
    gradeBand: latestPlan.goal.gradeBand,
    courseSlug: latestPlan.goal.courseSlug,
    // 课程定义已通过 6–12 个目标的受信 schema 校验。
    knowledgeNodeId: latestCourse.objectives[0]!.knowledgeNodeId,
  });
  if (!currentSession) return null;
  const currentPlan = await studyPlans.getOwnedBySession(
    identity.studentId,
    currentSession.sessionId,
  );
  if (!currentPlan) return null;
  const currentCourse = courseForPlan(currentPlan);
  return currentCourse
    ? {
        plan: currentPlan,
        course: currentCourse,
        sessionId: currentSession.sessionId,
      }
    : null;
}

/**
 * 创建 Session 后写 Notebook Goal；Goal 失败时只补偿删除本次新建且仍无 Goal 的 Notebook。
 * 调用方仍必须在两者都成功后才写身份 Cookie。
 */
export async function bootstrapStudyPlan(
  identity: AnonymousIdentity,
  rawInput: CreateStudyPlanInputDTO,
): Promise<StudyPlanSnapshot> {
  const input = createStudyPlanInputSchema.parse(rawInput);
  const course = getTrustedStudyCourse(input.gradeBand);
  const session = await learningSessions.bootstrap({
    studentId: identity.studentId,
    gradeBand: course.gradeBand,
    courseSlug: course.courseSlug,
    knowledgeNodeId: course.objectives[0]!.knowledgeNodeId,
    completeArtifact: demoLesson.artifact,
  });
  try {
    return await studyPlans.bootstrap({
      trustedStudentId: identity.studentId,
      declaredByUserId: identity.studentId,
      sessionId: session.sessionId,
      desiredOutcome: input.desiredOutcome,
      profile: {
        ageBand: input.ageBand,
        gradeBand: input.gradeBand,
        declarationSource: input.declarationSource,
        preferences: input.preferences,
      },
      course,
    });
  } catch (error) {
    if (session.created) {
      try {
        await bootstrapCompensator.discardUnplannedSession({
          trustedStudentId: identity.studentId,
          sessionId: session.sessionId,
        });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          '学习计划创建失败且新建Notebook补偿失败',
        );
      }
    }
    throw error;
  }
}

/** 页面状态只公开 setup、无答案诊断或已完成诊断的工作区三种状态。 */
export async function loadStudyPageState(
  identity: AnonymousIdentity | null,
): Promise<StudyPageState> {
  if (!identity) return { kind: 'setup' };
  const context = await loadOwnedStudyContext(identity);
  if (!context) return { kind: 'setup' };
  if (context.plan.latestDiagnostic) {
    return { kind: 'workspace', context };
  }
  const session = await new DrizzleSessionRepository(getDb()).getById(
    context.sessionId,
  );
  if (!session) return { kind: 'setup' };
  // 已有可信 mastery 的学生新开 Notebook 时 Session 从 EXPLAIN 起步，不重复短诊断。
  if (session.state !== 'DIAGNOSE') {
    return { kind: 'workspace', context };
  }
  return {
    kind: 'diagnostic',
    data: {
      topic: context.plan.goal.topic,
      desiredOutcome: context.plan.goal.desiredOutcome,
      diagnostic: projectPublicDiagnostic(context.course),
    },
  };
}

/** 诊断答案只在服务端与受信课程定义比对；仓储原子提交诊断事实、掌握度和状态迁移。 */
export async function submitStudyDiagnostic(
  identity: AnonymousIdentity,
  rawInput: SubmitDiagnosticInputDTO,
) {
  const submission = diagnosticSubmissionSchema.parse(rawInput);
  const context = await loadOwnedStudyContext(identity);
  if (!context) return { ok: false as const, code: 'STUDY_PLAN_NOT_FOUND' };
  const decision = gradeDiagnostic(context.course, submission);
  if (!decision.ok) return decision;
  const persisted = await diagnostics.submit({
    trustedStudentId: identity.studentId,
    goalId: context.plan.goal.id,
    sessionId: context.sessionId,
    course: context.course,
    graded: decision.result,
  });
  return { ok: true as const, result: persisted };
}
