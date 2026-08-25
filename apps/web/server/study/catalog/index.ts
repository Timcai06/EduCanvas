import 'server-only';

import {
  learnerGradeBandSchema,
  studyCourseDefinitionSchema,
  type LearnerGradeBand,
  type StudyCourseDefinition,
} from '@educanvas/teaching-core';
import {
  artifactSchema,
  type Artifact,
} from '@educanvas/canvas-protocol/server';
import {
  highImageAiArtifact,
  highImageAiCourse,
  legacyHighImageAiCourse,
} from './high-image-ai';
import { legacyImageAiArtifact } from './legacy-image-ai';
import {
  legacyMiddleImageAiCourse,
  middleImageAiArtifact,
  middleImageAiCourse,
} from './middle-image-ai';
import {
  legacyPrimaryHighImageAiCourse,
  legacyPrimaryLowImageAiCourse,
  primaryHighImageAiArtifact,
  primaryHighImageAiCourse,
  primaryLowImageAiArtifact,
  primaryLowImageAiCourse,
} from './primary-image-ai';

export interface TrustedStudyCourseContent {
  course: StudyCourseDefinition;
  artifact: Artifact;
}

function parseContent(
  input: TrustedStudyCourseContent,
): TrustedStudyCourseContent {
  return {
    course: studyCourseDefinitionSchema.parse(input.course),
    artifact: artifactSchema.parse(input.artifact),
  };
}

const currentContentByGradeBand: Record<
  LearnerGradeBand,
  TrustedStudyCourseContent
> = {
  primary_low: parseContent({
    course: primaryLowImageAiCourse,
    artifact: primaryLowImageAiArtifact,
  }),
  primary_high: parseContent({
    course: primaryHighImageAiCourse,
    artifact: primaryHighImageAiArtifact,
  }),
  middle_school: parseContent({
    course: middleImageAiCourse,
    artifact: middleImageAiArtifact,
  }),
  high_school: parseContent({
    course: highImageAiCourse,
    artifact: highImageAiArtifact,
  }),
};

/** 只用于恢复已持久化的 v1 Notebook；创建新计划时不会进入这个集合。 */
const historicalContent = [
  legacyPrimaryLowImageAiCourse,
  legacyPrimaryHighImageAiCourse,
  legacyMiddleImageAiCourse,
  legacyHighImageAiCourse,
].map((course) => parseContent({ course, artifact: legacyImageAiArtifact }));

function contentIdentity(course: StudyCourseDefinition): string {
  return `${course.gradeBand}:${course.courseSlug}:${course.version}`;
}

const registeredContent = [
  ...Object.values(currentContentByGradeBand),
  ...historicalContent,
];
const registeredIdentities = registeredContent.map((content) =>
  contentIdentity(content.course),
);
if (new Set(registeredIdentities).size !== registeredIdentities.length) {
  throw new Error('受信课程内容目录存在重复的学段、slug和版本');
}
const contentByIdentity = new Map(
  registeredContent.map((content) => [
    contentIdentity(content.course),
    content,
  ]),
);

/** 新计划只使用当前版本的完整课程内容包。 */
export function getTrustedStudyContent(
  rawGradeBand: LearnerGradeBand,
): TrustedStudyCourseContent {
  const gradeBand = learnerGradeBandSchema.parse(rawGradeBand);
  return currentContentByGradeBand[gradeBand];
}

/** 恢复计划时按冻结身份解析当前或受控历史内容，绝不猜测最近版本。 */
export function getTrustedStudyContentForGoal(input: {
  gradeBand: LearnerGradeBand;
  courseSlug: string;
  courseVersion: string;
}): TrustedStudyCourseContent | null {
  const gradeBand = learnerGradeBandSchema.parse(input.gradeBand);
  return (
    contentByIdentity.get(
      `${gradeBand}:${input.courseSlug}:${input.courseVersion}`,
    ) ?? null
  );
}

/** P1 只开放经过代码审查和版本冻结的课程目录，浏览器不能提交自定义目标图或答案。 */
export function getTrustedStudyCourse(
  rawGradeBand: LearnerGradeBand,
): StudyCourseDefinition {
  return getTrustedStudyContent(rawGradeBand).course;
}

/** 读取持久化 Goal 时同时核对 slug/version，目录漂移时诚实失败。 */
export function getTrustedStudyCourseForGoal(input: {
  gradeBand: LearnerGradeBand;
  courseSlug: string;
  courseVersion: string;
}): StudyCourseDefinition | null {
  return getTrustedStudyContentForGoal(input)?.course ?? null;
}
