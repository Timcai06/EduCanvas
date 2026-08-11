import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  LiveVoiceVisualStage,
  scrollLiveVoiceContextRail,
} from './live-voice-visual-stage';

describe('scrollLiveVoiceContextRail', () => {
  it('资料超过单轮上限时仍展示全部来源按钮供用户取消选择', () => {
    const html = renderToStaticMarkup(
      <LiveVoiceVisualStage
        assets={Array.from({ length: 65 }, (_, index) => ({
          id: `asset-${index}`,
          versionId: `version-${index}`,
          label: `资料 ${index}`,
          kind: 'document' as const,
          scope: 'space' as const,
          status: 'ready' as const,
          enabled: index < 63,
          selectable: true,
        }))}
        artifacts={[]}
        citations={[]}
        tools={[]}
      />,
    );

    expect(html.match(/data-live-stage-asset=/g)).toHaveLength(65);
    expect(html).toContain('资料 64');
  });

  it('把鼠标纵向滚轮转换为资料带横向滚动', () => {
    const preventDefault = vi.fn();
    const rail = {
      clientWidth: 300,
      scrollLeft: 120,
      scrollWidth: 900,
    } as HTMLDivElement;

    scrollLiveVoiceContextRail({
      currentTarget: rail,
      deltaX: 0,
      deltaY: 80,
      preventDefault,
    });

    expect(rail.scrollLeft).toBe(200);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('到达资料带末端后把纵向滚动交还给外层卡片', () => {
    const preventDefault = vi.fn();
    const rail = {
      clientWidth: 300,
      scrollLeft: 600,
      scrollWidth: 900,
    } as HTMLDivElement;

    scrollLiveVoiceContextRail({
      currentTarget: rail,
      deltaX: 0,
      deltaY: 80,
      preventDefault,
    });

    expect(rail.scrollLeft).toBe(600);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
