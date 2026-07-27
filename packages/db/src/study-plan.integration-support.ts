import type { StudyCourseDefinition } from '@educanvas/teaching-core';
import { getDb } from './client';
import { DrizzleLearningSessionRepository } from './learning-session-repository';
import { DrizzleStudyPlanRepository } from './study-plan-repository';

type Database = ReturnType<typeof getDb>;

export const studyTestCourse: StudyCourseDefinition = {
  courseSlug: 'integration-study',
  version: 'v1',
  gradeBand: 'middle_school',
  title: '集成测试课程',
  objectives: Array.from({ length: 6 }, (_, index) => ({
    objectiveKey: `objective-${index + 1}`,
    knowledgeNodeId: `integration.node-${index + 1}`,
    title: `目标 ${index + 1}`,
    description: `掌握集成测试目标 ${index + 1}`,
    sequence: index + 1,
    prerequisiteObjectiveKeys: index === 0 ? [] : [`objective-${index}`],
  })),
  diagnostic: {
    version: 'v1',
    questions: [1, 2, 3].map((number) => ({
      questionId: `question-${number}`,
      objectiveKey: `objective-${number}`,
      prompt: `问题 ${number}`,
      options: [
        { id: `q${number}-correct`, text: '正确选项' },
        { id: `q${number}-wrong`, text: '错误选项' },
      ],
      correctOptionId: `q${number}-correct`,
    })),
  },
};

export const studyTestArtifact = {
  schemaVersion: '1',
  artifactId: 'study-integration-artifact',
  type: 'quiz',
  title: '集成测试练习',
  params: {
    questions: [
      {
        id: 'artifact-q1',
        question: '测试问题',
        options: [
          { id: 'yes', text: '是' },
          { id: 'no', text: '否' },
        ],
        correctOptionId: 'yes',
      },
    ],
  },
} as const;

export function studyTestScope(studentId: string) {
  return {
    studentId,
    gradeBand: studyTestCourse.gradeBand,
    courseSlug: studyTestCourse.courseSlug,
    knowledgeNodeId: studyTestCourse.objectives[0]!.knowledgeNodeId,
  };
}

export async function bootstrapStudyTestPlan(
  database: Database,
  studentId = 'study-student',
) {
  const session = await new DrizzleLearningSessionRepository(
    database,
  ).bootstrap({
    ...studyTestScope(studentId),
    completeArtifact: studyTestArtifact,
  });
  const plan = await new DrizzleStudyPlanRepository(database).bootstrap({
    trustedStudentId: studentId,
    declaredByUserId: studentId,
    sessionId: session.sessionId,
    desiredOutcome: '完成集成测试课程',
    profile: {
      ageBand: '13_to_15',
      gradeBand: 'middle_school',
      declarationSource: 'self_declared',
      preferences: {
        explanationOrder: 'example_first',
        responseDepth: 'balanced',
        guidance: 'step_by_step',
        modality: 'mixed',
        feedbackStyle: 'balanced',
      },
    },
    course: studyTestCourse,
  });
  return { session, plan };
}
