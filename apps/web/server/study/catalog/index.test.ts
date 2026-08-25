import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { artifactSchema } from '@educanvas/canvas-protocol/server';
import {
  learnerGradeBandSchema,
  studyCourseDefinitionSchema,
} from '@educanvas/teaching-core';
import { getTrustedStudyContent, getTrustedStudyContentForGoal } from './index';

describe('trusted study course content catalog', () => {
  it('provides one validated current course package for every grade band', () => {
    const contents = learnerGradeBandSchema.options.map((gradeBand) =>
      getTrustedStudyContent(gradeBand),
    );

    expect(contents.map((content) => content.course.gradeBand)).toEqual(
      learnerGradeBandSchema.options,
    );
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
