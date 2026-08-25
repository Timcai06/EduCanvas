import 'server-only';

import { createHash } from 'node:crypto';
import type { StudyCourseDefinition } from '@educanvas/teaching-core';

export interface TrustedCourseKnowledgePublication {
  sourceKey: string;
  title: string;
  contentHash: string;
  objectKey: string;
  parserVersion: string;
  chunks: readonly {
    content: string;
    heading: string;
  }[];
}

/**
 * 把已经通过代码审查的课程目标转成可检索讲义。这里不包含诊断答案，
 * 也不接收浏览器正文；内容版本随冻结课程版本一起演进。
 */
export function createTrustedCourseKnowledge(
  course: StudyCourseDefinition,
): TrustedCourseKnowledgePublication {
  const objectiveTitleByKey = new Map(
    course.objectives.map((objective) => [
      objective.objectiveKey,
      objective.title,
    ]),
  );
  const chunks = [
    {
      heading: '课程导读',
      content: [
        `《${course.title}》面向 ${course.gradeBand} 学段。`,
        `本课程按 ${course.objectives.length} 个相互衔接的学习目标展开。学习时应先理解概念，再用课程活动验证自己的判断；遇到重要事实、隐私或安全问题时，需要使用可靠来源复核。`,
      ].join('\n\n'),
    },
    ...course.objectives.map((objective) => {
      const prerequisites = objective.prerequisiteObjectiveKeys
        .map((key) => objectiveTitleByKey.get(key))
        .filter((title): title is string => Boolean(title));
      return {
        heading: `${objective.sequence}. ${objective.title}`,
        content: [
          objective.description,
          prerequisites.length > 0
            ? `学习本节前，先确认已经理解：${prerequisites.join('、')}。`
            : '这是本课程的起点，不要求先掌握其他课程目标。',
          `完成本节后，应能用自己的话解释“${objective.title}”，并在新的例子中说明判断依据，而不是只记住结论。`,
        ].join('\n\n'),
      };
    }),
  ] as const;
  const canonicalText = chunks
    .map((chunk) => `## ${chunk.heading}\n\n${chunk.content}`)
    .join('\n\n');

  return {
    sourceKey: `course-notes-${course.version}`,
    title: `${course.title} · 课程讲义`,
    contentHash: createHash('sha256').update(canonicalText).digest('hex'),
    objectKey: `courses/${course.gradeBand}/${course.courseSlug}/${course.version}/lesson.md`,
    parserVersion: 'trusted-course-markdown-v1',
    chunks,
  };
}
