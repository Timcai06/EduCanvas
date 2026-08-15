import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './chat-panel';
import { chatMinimapMessageLabel } from './chat-minimap';
import type { ChatMessage } from './messages';

vi.mock('@gsap/react', () => ({ useGSAP: () => undefined }));

const messages: readonly ChatMessage[] = [
  {
    id: 'student-1',
    turnId: 'turn-1',
    clientMessageId: 'client-1',
    role: 'student',
    status: 'completed',
    text: '请解释光合作用。',
    attachments: [],
  },
  {
    id: 'assistant-1',
    turnId: 'turn-1',
    clientMessageId: 'client-1',
    role: 'assistant',
    status: 'completed',
    text: '光合作用会把光能转化为化学能。',
    attachments: [],
  },
];

describe('Chat minimap anchors', () => {
  it('为每条消息输出可聚焦的稳定锚点与角色', () => {
    const html = renderToStaticMarkup(
      <ChatPanel
        messages={messages}
        canvasOpen={false}
        artifactTitle=""
        onOpenCanvas={vi.fn()}
        onContinueText={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('data-chat-message-id="student-1"');
    expect(html).toContain('data-chat-turn-id="turn-1"');
    expect(html).toContain('data-chat-message-role="student"');
    expect(html).toContain('data-chat-message-id="assistant-1"');
    expect(html).toContain('data-chat-message-role="assistant"');
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  });

  it('为文字、长文字和附件消息生成短而可辨识的导航标签', () => {
    expect(chatMinimapMessageLabel(messages[0])).toBe('你 · 请解释光合作用。');
    expect(
      chatMinimapMessageLabel({
        ...messages[1],
        text: '一'.repeat(60),
      }),
    ).toBe(`AI · ${'一'.repeat(42)}…`);
    expect(
      chatMinimapMessageLabel({
        ...messages[0],
        text: '',
        attachments: [{ id: 'asset-1', label: '课件', kind: 'document' }],
      }),
    ).toBe('你 · 包含 1 个附件');
  });
});
