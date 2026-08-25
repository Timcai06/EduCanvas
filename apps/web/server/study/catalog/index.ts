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
import {
  primaryHighRecommendationArtifact,
  primaryHighRecommendationCourse,
  primaryLowAiSafetyArtifact,
  primaryLowAiSafetyCourse,
} from './primary-ai-literacy';
import {
  highGenerativeAiArtifact,
  highGenerativeAiCourse,
  middleRecommendationArtifact,
  middleRecommendationCourse,
} from './secondary-ai-literacy';
import {
  createTrustedCourseKnowledge,
  type TrustedCourseKnowledgePublication,
} from './course-knowledge';

export interface TrustedStudyCourseContent {
  course: StudyCourseDefinition;
  artifact: Artifact;
  knowledgePublication: TrustedCourseKnowledgePublication | null;
}

function parseContent(
  input: Pick<TrustedStudyCourseContent, 'course' | 'artifact'>,
  options: { publishKnowledge?: boolean } = {},
): TrustedStudyCourseContent {
  const course = studyCourseDefinitionSchema.parse(input.course);
  return {
    course,
    artifact: artifactSchema.parse(input.artifact),
    knowledgePublication:
      options.publishKnowledge === false
        ? null
        : createTrustedCourseKnowledge(course),
  };
}

const currentContentByGradeBand: Record<
  LearnerGradeBand,
  readonly TrustedStudyCourseContent[]
> = {
  primary_low: [
    parseContent({
      course: primaryLowImageAiCourse,
      artifact: primaryLowImageAiArtifact,
    }),
    parseContent({
      course: primaryLowAiSafetyCourse,
      artifact: primaryLowAiSafetyArtifact,
    }),
  ],
  primary_high: [
    parseContent({
      course: primaryHighImageAiCourse,
      artifact: primaryHighImageAiArtifact,
    }),
    parseContent({
      course: primaryHighRecommendationCourse,
      artifact: primaryHighRecommendationArtifact,
    }),
  ],
  middle_school: [
    parseContent({
      course: middleImageAiCourse,
      artifact: middleImageAiArtifact,
    }),
    parseContent({
      course: middleRecommendationCourse,
      artifact: middleRecommendationArtifact,
    }),
  ],
  high_school: [
    parseContent({
      course: highImageAiCourse,
      artifact: highImageAiArtifact,
    }),
    parseContent({
      course: highGenerativeAiCourse,
      artifact: highGenerativeAiArtifact,
    }),
  ],
};

/** 只用于恢复已持久化的 v1 Notebook；创建新计划时不会进入这个集合。 */
const historicalContent = [
  legacyPrimaryLowImageAiCourse,
  legacyPrimaryHighImageAiCourse,
  legacyMiddleImageAiCourse,
  legacyHighImageAiCourse,
].map((course) =>
  parseContent(
    { course, artifact: legacyImageAiArtifact },
    { publishKnowledge: false },
  ),
);

function contentIdentity(course: StudyCourseDefinition): string {
  return `${course.gradeBand}:${course.courseSlug}:${course.version}`;
}

const registeredContent = [
  ...Object.values(currentContentByGradeBand).flat(),
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

/** 新计划只使用当前目录中的完整内容包；未指定主题时保留每学段原默认课程。 */
export function getTrustedStudyContent(
  rawGradeBand: LearnerGradeBand,
  rawCourseSlug?: string,
): TrustedStudyCourseContent {
  const gradeBand = learnerGradeBandSchema.parse(rawGradeBand);
  const contents = currentContentByGradeBand[gradeBand];
  const content = rawCourseSlug
    ? contents.find(
        (candidate) => candidate.course.courseSlug === rawCourseSlug,
      )
    : contents[0];
  if (!content) throw new Error('所选课程不属于当前学段或尚未进入受信目录');
  return content;
}

/** 浏览器只接收当前课程的稳定标识与标题，不暴露目标图、诊断答案或 Artifact 答案。 */
export function listTrustedStudyCourseOptions() {
  return learnerGradeBandSchema.options.flatMap((gradeBand) =>
    currentContentByGradeBand[gradeBand].map(({ course }) => ({
      gradeBand,
      courseSlug: course.courseSlug,
      title: course.title,
    })),
  );
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
