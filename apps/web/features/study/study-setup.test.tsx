import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StudySetup } from './study-setup';

vi.mock('@/app/learn/actions', () => ({
  createStudyPlanAction: vi.fn(),
}));

describe('StudySetup', () => {
  const courseOptions = [
    {
      gradeBand: 'primary_low' as const,
      courseSlug: 'image-ai-primary-low',
      title: '图像 AI 入门',
    },
    {
      gradeBand: 'primary_low' as const,
      courseSlug: 'ai-safety-primary-low',
      title: '和 AI 说话也要保护自己',
    },
    {
      gradeBand: 'primary_high' as const,
      courseSlug: 'image-ai-primary-high',
      title: '图像 AI 与训练样例',
    },
    {
      gradeBand: 'primary_high' as const,
      courseSlug: 'recommendation-ai-primary-high',
      title: '推荐列表为什么懂我',
    },
    {
      gradeBand: 'middle_school' as const,
      courseSlug: 'image-ai-middle',
      title: '图像分类与数据',
    },
    {
      gradeBand: 'middle_school' as const,
      courseSlug: 'recommendation-ai-middle',
      title: '推荐算法与反馈循环',
    },
    {
      gradeBand: 'high_school' as const,
      courseSlug: 'image-ai-high',
      title: '图像模型评估与责任边界',
    },
    {
      gradeBand: 'high_school' as const,
      courseSlug: 'generative-ai-high',
      title: '生成式 AI 与证据核验',
    },
  ];

  it('presents the four canonical grade bands and current grade topics', () => {
    const html = renderToStaticMarkup(
      <StudySetup courseOptions={courseOptions} />,
    );

    expect(html).toContain('小学低年级');
    expect(html).toContain('小学高年级');
    expect(html).toContain('初中');
    expect(html).toContain('高中');
    expect(html).toContain('图像 AI 入门');
    expect(html).toContain('和 AI 说话也要保护自己');
    expect(html).not.toContain('primary_school');
  });
});
