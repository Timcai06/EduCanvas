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

  it('工具与产物的真实状态会作为投影文本展示，便于 Live 侧进度核验', () => {
    const html = renderToStaticMarkup(
      <LiveVoiceVisualStage
        assets={[]}
        artifacts={[
          {
            id: 'artifact-running',
            kind: 'note',
            title: '文档草稿',
            status: 'generating',
          },
          {
            id: 'artifact-ready',
            kind: 'note',
            title: '总结',
            status: 'active',
          },
          {
            id: 'artifact-failed',
            kind: 'note',
            title: '失败样例',
            status: 'failed',
          },
        ]}
        tools={[
          {
            id: 'tool-running',
            label: '分析图片',
            status: 'running',
          },
          {
            id: 'tool-failed',
            label: '生成摘要',
            status: 'failed',
          },
          {
            id: 'tool-completed',
            label: '提取正文',
            status: 'completed',
          },
        ]}
        citations={[]}
      />,
    );

    expect(html).toContain('<small> · 执行中</small>');
    expect(html).toContain('<small> · 失败</small>');
    expect(html).toContain('<small> · 已完成</small>');
    expect(html).toContain('文档草稿</span><small>生成中</small>');
    expect(html).toContain('总结</span><small>已生成</small>');
    expect(html).toContain('失败样例</span><small>生成失败</small>');
  });
});
