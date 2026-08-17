import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Composer, normalizeDeepResearchTopic } from './composer';

vi.mock('@gsap/react', () => ({ useGSAP: () => undefined }));

describe('Composer Deep Research entry', () => {
  it('只在提供研究动作时显示桌面研究入口', () => {
    const html = renderToStaticMarkup(
      <Composer
        chips={[]}
        busy={false}
        statusText={null}
        value=""
        onValueChange={vi.fn()}
        onSend={vi.fn()}
        onRemoveChip={vi.fn()}
        onMenuAction={vi.fn()}
        onDeepResearch={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="深度研究"');
    expect(html).not.toContain('role="dialog"');
  });

  it('规范化研究主题并拒绝空主题', () => {
    expect(normalizeDeepResearchTopic('  光合作用的研究进展  ')).toBe(
      '光合作用的研究进展',
    );
    expect(normalizeDeepResearchTopic('   ')).toBeNull();
  });
});
