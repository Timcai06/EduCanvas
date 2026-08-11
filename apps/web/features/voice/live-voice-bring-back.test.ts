import { describe, expect, it } from 'vitest';
import {
  assembleLiveVoiceExitPayload,
  formatLiveVoiceLetterMarkdown,
} from './live-voice-bring-back';

const NOW = new Date('2026-08-11T14:05:00').getTime();

describe('assembleLiveVoiceExitPayload', () => {
  it('会话有新对话时返回 payload，空白文本被剔除', () => {
    const payload = assembleLiveVoiceExitPayload({
      sessionTranscript: [
        { id: 'a', speaker: '你', text: '  这道题怎么做  ' },
        { id: 'b', speaker: 'AI', text: '   ' },
        { id: 'c', speaker: 'AI', text: '先看已知条件' },
      ],
      now: NOW,
    });
    expect(payload).not.toBeNull();
    expect(payload?.endedAt).toBe(NOW);
    expect(payload?.sessionTranscript.map((entry) => entry.id)).toEqual([
      'a',
      'c',
    ]);
    expect(payload?.touchedArtifactIds).toEqual([]);
    expect(payload?.annotations).toEqual([]);
  });

  it('空会话返回 null——空会话不留痕', () => {
    expect(
      assembleLiveVoiceExitPayload({ sessionTranscript: [], now: NOW }),
    ).toBeNull();
    expect(
      assembleLiveVoiceExitPayload({
        sessionTranscript: [{ id: 'a', speaker: '你', text: '   ' }],
        now: NOW,
      }),
    ).toBeNull();
  });

  it('仅触碰产物时也留痕（无对话）', () => {
    const payload = assembleLiveVoiceExitPayload({
      sessionTranscript: [],
      touchedArtifactIds: ['artifact-1'],
      now: NOW,
    });
    expect(payload?.touchedArtifactIds).toEqual(['artifact-1']);
  });

  it('仅有圈点时仍生成带回 payload', () => {
    const annotation = {
      clientId: 'mark-1',
      resourceKind: 'source' as const,
      resourceId: '2570e43a-cb28-4bb8-914f-566b1f5539d9',
      resourceVersionId: null,
      kind: 'circle' as const,
      geometry: { x: 0.2, y: 0.3, width: 0.18, height: 0.13 },
    };
    const payload = assembleLiveVoiceExitPayload({
      sessionTranscript: [],
      annotations: [annotation],
      now: NOW,
    });
    expect(payload?.annotations).toEqual([annotation]);
  });
});

describe('formatLiveVoiceLetterMarkdown', () => {
  it('装订为带时间戳的说话人段落', () => {
    const markdown = formatLiveVoiceLetterMarkdown(
      [
        { id: 'a', speaker: '你', text: '这道题怎么做' },
        { id: 'c', speaker: 'AI', text: '先看已知条件' },
      ],
      NOW,
    );
    expect(markdown).toContain('## Live Voice 会话 · 2026-08-11 14:05');
    expect(markdown).toContain('**你**：这道题怎么做');
    expect(markdown).toContain('**AI**：先看已知条件');
    expect(markdown.indexOf('**你**')).toBeLessThan(markdown.indexOf('**AI**'));
  });
});
