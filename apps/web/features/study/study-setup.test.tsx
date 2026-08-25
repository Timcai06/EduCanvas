import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StudySetup } from './study-setup';

vi.mock('@/app/learn/actions', () => ({
  createStudyPlanAction: vi.fn(),
}));

describe('StudySetup', () => {
  it('presents the four canonical grade bands', () => {
    const html = renderToStaticMarkup(<StudySetup />);

    expect(html).toContain('小学低年级');
    expect(html).toContain('小学高年级');
    expect(html).toContain('初中');
    expect(html).toContain('高中');
    expect(html).not.toContain('primary_school');
  });
});
