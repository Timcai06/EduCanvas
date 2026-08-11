import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  filterLiveSessionTranscript,
  mergeDictationTranscript,
  resolveLiveVoiceVisualPhase,
  VoiceComposerRuntime,
} from './voice-composer';

const healthyChecks = [
  { key: 'model' as const, healthy: true },
  { key: 'speech' as const, healthy: true },
  { key: 'connection' as const, healthy: true },
];

function render(checks = healthyChecks) {
  const createCapture = vi.fn(() => {
    throw new Error('SSR 不得创建 capture');
  });
  const createClient = vi.fn(() => {
    throw new Error('SSR 不得创建 client');
  });
  const html = renderToStaticMarkup(
    <VoiceComposerRuntime
      notebookId="notebook:1"
      capabilityChecks={checks}
      runtime={{ createCapture, createClient }}
      chips={[]}
      busy={false}
      statusText={null}
      onSend={vi.fn()}
      onRemoveChip={vi.fn()}
      onMenuAction={vi.fn()}
    />,
  );
  return { html, createCapture, createClient };
}

describe('VoiceComposerRuntime', () => {
  it('SSR 初始渲染显示双入口且不触碰浏览器 runtime', () => {
    const result = render();
    expect(result.html).toContain('Live Voice');
    expect(result.html).toContain('aria-label="语音转文字"');
    expect(result.html).not.toContain('短句');
    expect(result.html).not.toContain('课堂字幕');
    expect(result.createCapture).not.toHaveBeenCalled();
    expect(result.createClient).not.toHaveBeenCalled();
  });

  it('连接不可用时入口禁用且原因可读', () => {
    const result = render(
      healthyChecks.map((check) =>
        check.key === 'connection' ? { ...check, healthy: false } : check,
      ),
    );
    expect(result.html).toContain('disabled=""');
    expect(result.html).toContain('实时语音连接暂不可用');
  });
});

describe('mergeDictationTranscript', () => {
  it('每次 partial 都基于录音前草稿替换，不重复累加中间结果', () => {
    expect(mergeDictationTranscript('已有内容', '你')).toBe('已有内容 你');
    expect(mergeDictationTranscript('已有内容', '你好')).toBe('已有内容 你好');
  });

  it('空转写不覆盖已有草稿', () => {
    expect(mergeDictationTranscript('已有内容', '   ')).toBe('已有内容');
  });
});

describe('filterLiveSessionTranscript', () => {
  it('基线锚点离开滑动窗口后也不会重新引入进入 Live 前的消息', () => {
    const entries = [
      { id: 'before-2', speaker: 'AI' as const, text: '旧消息' },
      { id: 'live-user', speaker: '你' as const, text: '本轮问题' },
    ];

    expect(
      filterLiveSessionTranscript(entries, ['before-1', 'before-2']),
    ).toEqual([entries[1]]);
  });

  it('进入 Live 后产生的消息保持原顺序', () => {
    const entries = [
      { id: 'before', speaker: 'AI' as const, text: '进入前' },
      { id: 'user', speaker: '你' as const, text: '问题' },
      { id: 'assistant', speaker: 'AI' as const, text: '回答' },
    ];

    expect(filterLiveSessionTranscript(entries, ['before'])).toEqual(
      entries.slice(1),
    );
  });
});

describe('resolveLiveVoiceVisualPhase', () => {
  it('按用户可感知优先级映射静音、失败、播放和思考状态', () => {
    expect(
      resolveLiveVoiceVisualPhase({
        muted: true,
        busy: true,
        speaking: true,
        status: 'failed',
      }),
    ).toBe('muted');
    expect(
      resolveLiveVoiceVisualPhase({
        muted: false,
        busy: true,
        speaking: false,
        status: 'recording',
      }),
    ).toBe('thinking');
    expect(
      resolveLiveVoiceVisualPhase({
        muted: false,
        busy: false,
        speaking: true,
        status: 'recording',
      }),
    ).toBe('speaking');
  });

  it('区分连接、聆听和空闲', () => {
    const phase = (
      status: Parameters<typeof resolveLiveVoiceVisualPhase>[0]['status'],
    ) =>
      resolveLiveVoiceVisualPhase({
        muted: false,
        busy: false,
        speaking: false,
        status,
      });
    expect(phase('starting')).toBe('connecting');
    expect(phase('recording')).toBe('listening');
    expect(phase('finalizing')).toBe('listening');
    expect(phase('stopped')).toBe('idle');
  });
});
