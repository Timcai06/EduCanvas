import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  LiveVoicePanel,
  resolveLiveVoiceActiveTranscript,
  toLiveVoiceDisplayText,
} from './live-voice-panel';

describe('LiveVoicePanel', () => {
  it('将聊天 Markdown 收敛为适合语音字幕的纯文本', () => {
    expect(
      toLiveVoiceDisplayText('## 结论\n**欧拉公式**：`e^{i\\theta}`'),
    ).toBe('结论 欧拉公式 ： e^ iθ');
  });

  it('保留状态、字幕和可操作的语义层，不依赖动效表达信息', () => {
    const html = renderToStaticMarkup(
      <LiveVoicePanel
        phase="listening"
        statusLabel="正在聆听"
        muted={false}
        userSubtitle="我想了解监督学习"
        assistantMessageId="assistant-1"
        assistantText="它是一类从数据中学习的方法。"
        assistantStatus="completed"
        assistantSubtitle={null}
        transcript={[
          { id: 'user-1', speaker: '你', text: '什么是机器学习？' },
          { id: 'ai-1', speaker: 'AI', text: '它是一类从数据中学习的方法。' },
        ]}
        onToggleMute={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Live Voice"');
    expect(html).toContain('正在聆听');
    expect(html).not.toContain('它是一类从数据中学习的方法。');
    expect(html).toContain('我想了解监督学习');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="暂停聆听"');
    expect(html).toContain('结束');
    expect(html).toContain('data-live-morph="true"');
    expect(html).toContain('data-live-glow="true"');
    expect(html).toContain('gradientUnits="userSpaceOnUse"');
    expect(html).toContain('stop-color="var(--color-accent-strong)"');
    expect(html.match(/data-live-morph=/g)).toHaveLength(1);
    expect(html).not.toContain('data-live-field');
    expect(html).not.toContain('data-live-ring');
    expect(html).not.toContain('data-live-particle');
    expect(html).not.toContain('data-live-aura-layer');
  });

  it('聆听状态不使用最近聊天消息兜底，避免旧记录长期驻留', () => {
    const active = resolveLiveVoiceActiveTranscript({
      phase: 'listening',
      userSubtitle: null,
      assistantMessageId: 'assistant-old',
      assistantText: '上一轮完整回答',
      assistantStatus: 'completed',
      assistantSubtitle: '上一轮最后一句',
      transcript: [
        { id: 'user-1', speaker: '你', text: '上一轮问题' },
        { id: 'ai-1', speaker: 'AI', text: '上一轮完整回答' },
      ],
    });

    expect(active).toBeNull();
  });

  it('思考时只短暂承接本轮用户 final，不展示历史 Assistant 回答', () => {
    expect(
      resolveLiveVoiceActiveTranscript({
        phase: 'thinking',
        userSubtitle: null,
        assistantMessageId: null,
        assistantText: null,
        assistantStatus: null,
        assistantSubtitle: null,
        transcript: [
          { id: 'ai-old', speaker: 'AI', text: '旧回答' },
          { id: 'user-current', speaker: '你', text: '本轮问题' },
        ],
      }),
    ).toEqual({ id: 'user-current', speaker: '你', text: '本轮问题' });
  });

  it('播报时完整回答继续增长，PCM cue 保持独立', () => {
    expect(
      resolveLiveVoiceActiveTranscript({
        phase: 'speaking',
        userSubtitle: null,
        assistantMessageId: 'assistant-current',
        assistantText: '完整回答继续增长。这里是新到达的文字。',
        assistantStatus: 'streaming',
        assistantSubtitle: '正在读的这一句。',
        transcript: [
          { id: 'ai-full', speaker: 'AI', text: '完整回答不应覆盖 cue。' },
        ],
      }),
    ).toEqual({
      id: 'live-assistant:assistant-current',
      speaker: 'AI',
      text: '正在读的这一句。',
    });
  });

  it('渲染时仅显示可听 cue，不将完整回答冒充主字幕', () => {
    const html = renderToStaticMarkup(
      <LiveVoicePanel
        phase="speaking"
        statusLabel="正在回答"
        muted={false}
        userSubtitle={null}
        assistantMessageId="assistant-current"
        assistantText="完整回答已经增长到这里。"
        assistantStatus="streaming"
        assistantSubtitle="当前正在播放的短语。"
        onToggleMute={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).not.toContain('完整回答已经增长到这里。');
    expect(html).toContain('data-live-audible-cue="true"');
    expect(html).toContain('当前正在播放的短语。');
  });

  it('长回答在 Live 内展示 canonical 增量正文且不冒充 aria-live 字幕', () => {
    const longAnswer = `## 推导思路\n\n${'先观察变量之间的关系，再逐步验证每一个条件。'.repeat(12)}`;
    const html = renderToStaticMarkup(
      <LiveVoicePanel
        phase="speaking"
        statusLabel="正在回答"
        muted={false}
        userSubtitle={null}
        assistantMessageId="assistant-long"
        assistantText={longAnswer}
        assistantStatus="streaming"
        assistantSubtitle="先观察变量之间的关系。"
        onToggleMute={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('data-live-answer-reader="true"');
    expect(html).toContain('推导思路');
    expect(html).toContain('回答正在生成');
    expect(html).toContain('data-live-audible-cue="true"');
    expect(html).not.toContain(
      'data-live-answer-reader="true" aria-live="polite"',
    );
  });

  it('思考阶段未有字幕时显示已提交用户问题', () => {
    expect(
      resolveLiveVoiceActiveTranscript({
        phase: 'thinking',
        userSubtitle: null,
        assistantMessageId: null,
        assistantText: null,
        assistantStatus: null,
        assistantSubtitle: null,
        transcript: [
          { id: 'ai-old', speaker: 'AI', text: '旧回答' },
          { id: 'user-current', speaker: '你', text: '本轮问题' },
          { id: 'ai-now', speaker: 'AI', text: '新回答' },
        ],
      }),
    ).toMatchObject({ id: 'user-current', speaker: '你', text: '本轮问题' });
  });

  it('思考/接管期不提前显示尚未进入播放相位的 subtitle', () => {
    expect(
      resolveLiveVoiceActiveTranscript({
        phase: 'thinking',
        userSubtitle: null,
        assistantMessageId: 'assistant-current',
        assistantText: '先看定义，再比较两个例子。',
        assistantStatus: 'streaming',
        assistantSubtitle: '接管到这一句。',
        transcript: [],
      }),
    ).toBeNull();
  });

  it('静音时不展示完整 Assistant 文本', () => {
    expect(
      resolveLiveVoiceActiveTranscript({
        phase: 'muted',
        userSubtitle: null,
        assistantMessageId: 'assistant-current',
        assistantText: '完整回答仍不应可见。',
        assistantStatus: 'streaming',
        assistantSubtitle: null,
        transcript: [],
      }),
    ).toBeNull();
  });

  it('静音态给出明确恢复动作', () => {
    const html = renderToStaticMarkup(
      <LiveVoicePanel
        phase="muted"
        statusLabel="已静音"
        muted
        userSubtitle={null}
        assistantMessageId={null}
        assistantText={null}
        assistantStatus={null}
        assistantSubtitle={null}
        onToggleMute={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('点按麦克风继续');
    expect(html).toContain('aria-label="继续聆听"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('把来源、工具、引用和产物投影进沉浸舞台，不复制完整聊天记录', () => {
    const html = renderToStaticMarkup(
      <LiveVoicePanel
        phase="thinking"
        statusLabel="正在分析资料"
        muted={false}
        userSubtitle={null}
        assistantMessageId={null}
        assistantText={null}
        assistantStatus={null}
        assistantSubtitle={null}
        assets={[
          {
            id: 'image-1',
            versionId: 'image-version-1',
            label: '函数图像.png',
            kind: 'image',
            scope: 'space',
            status: 'ready',
            enabled: true,
            selectable: true,
            previewUrl: '/api/v1/chat/assets/image-1/file',
          },
        ]}
        tools={[{ id: 'tool-1', label: '正在分析图片', status: 'running' }]}
        citations={[{ id: 'citation-1', label: '课程讲义', pageStart: 3 }]}
        artifacts={[
          {
            id: 'artifact-1',
            kind: 'generated_image',
            title: '函数示意图',
            status: 'active',
          },
        ]}
        onToggleMute={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('本轮上下文');
    expect(html).toContain('函数图像.png');
    expect(html).toContain('正在分析图片');
    expect(html).toContain('课程讲义');
    expect(html).toContain('函数示意图');
    expect(html).toContain('/api/v1/chat/assets/image-1/file');
  });
});
