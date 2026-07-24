import 'server-only';

import {
  learnerGradeBandSchema,
  studyCourseDefinitionSchema,
  type LearnerGradeBand,
  type StudyCourseDefinition,
} from '@educanvas/teaching-core';
import { highImageAiCourse } from './high-image-ai';
import { middleImageAiCourse } from './middle-image-ai';
import { primaryImageAiCourse } from './primary-image-ai';

const courseByGradeBand: Record<LearnerGradeBand, StudyCourseDefinition> = {
  primary_school: studyCourseDefinitionSchema.parse(primaryImageAiCourse),
  middle_school: studyCourseDefinitionSchema.parse(middleImageAiCourse),
  high_school: studyCourseDefinitionSchema.parse(highImageAiCourse),
};

/** P1 只开放经过代码审查和版本冻结的课程目录，浏览器不能提交自定义目标图或答案。 */
export function getTrustedStudyCourse(
  rawGradeBand: LearnerGradeBand,
): StudyCourseDefinition {
  const gradeBand = learnerGradeBandSchema.parse(rawGradeBand);
  return courseByGradeBand[gradeBand];
}

/** 读取持久化 Goal 时同时核对 slug/version，目录漂移时诚实失败。 */
export function getTrustedStudyCourseForGoal(input: {
  gradeBand: LearnerGradeBand;
  courseSlug: string;
  courseVersion: string;
}): StudyCourseDefinition | null {
  const course = getTrustedStudyCourse(input.gradeBand);
  return course.courseSlug === input.courseSlug &&
    course.version === input.courseVersion
    ? course
    : null;
}
