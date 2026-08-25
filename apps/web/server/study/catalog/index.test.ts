import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { artifactSchema } from '@educanvas/canvas-protocol/server';
import {
  learnerGradeBandSchema,
  studyCourseDefinitionSchema,
} from '@educanvas/teaching-core';
import {
  getTrustedStudyContent,
  getTrustedStudyContentForGoal,
  listTrustedStudyCourseOptions,
} from './index';

describe('trusted study course content catalog', () => {
  it('provides two validated current course packages for every grade band', () => {
    const options = listTrustedStudyCourseOptions();
    const contents = options.map((option) =>
      getTrustedStudyContent(option.gradeBand, option.courseSlug),
    );

    expect(options).toHaveLength(8);
    for (const gradeBand of learnerGradeBandSchema.options) {
      expect(
        options.filter((option) => option.gradeBand === gradeBand),
      ).toHaveLength(2);
    }
    expect(
      new Set(contents.map((content) => content.course.courseSlug)).size,
    ).toBe(contents.length);
    expect(
      new Set(contents.map((content) => content.artifact.artifactId)).size,
    ).toBe(contents.length);
    for (const content of contents) {
      expect(
        studyCourseDefinitionSchema.safeParse(content.course).success,
      ).toBe(true);
      expect(artifactSchema.safeParse(content.artifact).success).toBe(true);
      expect(content.artifact.artifactId).not.toBe('demo-cat-dog');
    }
  });

  it('rejects a topic that is not registered for the selected grade band', () => {
    expect(() =>
      getTrustedStudyContent('primary_low', 'generative-ai-high'),
    ).toThrow('所选课程不属于当前学段');
  });

  it.each([
    ['primary_low', 'image-ai-primary'],
    ['primary_high', 'image-ai-primary'],
    ['middle_school', 'image-ai-middle'],
    ['high_school', 'image-ai-high'],
  ] as const)(
    'restores the frozen %s v1 identity without selecting it for new plans',
    (gradeBand, courseSlug) => {
      const historical = getTrustedStudyContentForGoal({
        gradeBand,
        courseSlug,
        courseVersion: 'v1',
      });
      const current = getTrustedStudyContent(gradeBand);

      expect(historical?.artifact.artifactId).toBe('demo-cat-dog');
      expect(historical?.course.version).toBe('v1');
      expect(current.artifact.artifactId).not.toBe('demo-cat-dog');
      expect(current.course).not.toBe(historical?.course);
    },
  );

  it('fails closed for an unknown frozen course version', () => {
    expect(
      getTrustedStudyContentForGoal({
        gradeBand: 'high_school',
        courseSlug: 'image-ai-high',
        courseVersion: 'v999',
      }),
    ).toBeNull();
  });
});
