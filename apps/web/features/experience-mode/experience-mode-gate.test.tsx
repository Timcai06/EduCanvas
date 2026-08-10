import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { experienceModeSelectionSchema } from './experience-mode-contract';
import { ExperienceModeGate } from './experience-mode-gate';

describe('ExperienceModeGate', () => {
  it('未选择时显示双模式且不挂载产品内容', () => {
    const html = renderToStaticMarkup(
      <ExperienceModeGate initialMode={null}>
        <p>产品内容</p>
      </ExperienceModeGate>,
    );
    expect(html).toContain('限制模式');
    expect(html).toContain('通用模式');
    expect(html).toContain('音频只用于本次识别，不会留存');
    expect(html).not.toContain('产品内容');
  });

  it.each(['restricted', 'general'] as const)(
    '已有 %s 模式时直接挂载产品内容',
    (mode) => {
      const html = renderToStaticMarkup(
        <ExperienceModeGate initialMode={mode}>
          <p>产品内容</p>
        </ExperienceModeGate>,
      );
      expect(html).toContain('产品内容');
      expect(html).not.toContain('请选择使用模式');
    },
  );

  it('通用模式要求显式确认，限制模式不要求', () => {
    expect(
      experienceModeSelectionSchema.safeParse({ mode: 'restricted' }).success,
    ).toBe(true);
    expect(
      experienceModeSelectionSchema.safeParse({ mode: 'general' }).success,
    ).toBe(false);
    expect(
      experienceModeSelectionSchema.safeParse({
        mode: 'general',
        guardianConfirmed: true,
      }).success,
    ).toBe(true);
  });
});
