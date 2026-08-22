import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './chat-panel';
import {
  buildChatMinimapSections,
  resolveChatMinimapLayout,
} from './chat-minimap';
import type { ChatMessage } from './messages';

vi.mock('@gsap/react', () => ({ useGSAP: () => undefined }));

function turn(index: number): readonly ChatMessage[] {
  return [
    {
      id: `student-${index}`,
      turnId: `turn-${index}`,
      clientMessageId: `client-${index}`,
      role: 'student',
      status: 'completed',
      text: `用户问题 ${index}`,
      attachments: [],
    },
    {
      id: `assistant-${index}`,
      turnId: `turn-${index}`,
      clientMessageId: `client-${index}`,
      role: 'assistant',
      status: 'completed',
      text: `AI 回答 ${index}`,
      attachments: [],
    },
  ];
}

const messages = [...turn(1), ...turn(2)];

describe('Chat minimap anchors', () => {
  it('把网页引用投影为 Notebook Source 与原网页两个独立动作', () => {
    const html = renderToStaticMarkup(
      <ChatPanel
        messages={[
          {
            id: 'assistant-research',
            turnId: 'turn-research',
            clientMessageId: 'client-research',
            role: 'assistant',
            status: 'completed',
            text: '结论 [1]',
            attachments: [],
            citations: [
              {
                id: 'citation-1',
                kind: 'web',
                marker: 1,
                label: '研究网页',
                assetId: 'asset-1',
                assetVersionId: 'version-1',
                url: 'https://example.com/research',
                pageStart: null,
                pageEnd: null,
              },
            ],
          },
        ]}
        canvasOpen={false}
        artifactTitle=""
        onOpenCanvas={vi.fn()}
        onContinueText={vi.fn()}
        onRetry={vi.fn()}
        onOpenSource={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="打开来源 研究网页"');
    expect(html).toContain('title="打开 Notebook Source"');
    expect(html).toContain('href="https://example.com/research"');
    expect(html).toContain('aria-label="打开原网页 研究网页"');
  });

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
    expect(html).toContain('data-chat-message-role="student"');
    expect(html).toContain('data-chat-message-id="assistant-1"');
    expect(html).toContain('data-chat-message-role="assistant"');
    expect(html.match(/tabindex="-1"/g)).toHaveLength(4);
  });

  it('保留全部提问锚点并把节点绑定到对应学生消息', () => {
    const longConversation = Array.from({ length: 14 }, (_, index) =>
      turn(index + 1),
    ).flat();
    const sections = buildChatMinimapSections(longConversation);

    expect(sections).toHaveLength(14);
    expect(sections[0]).toEqual({
      id: 'turn-1',
      messageId: 'student-1',
      preview: '用户问题 1',
    });
  });

  it('用统一阅读线解析唯一 active 章节，并保持真实内容坐标', () => {
    const layout = resolveChatMinimapLayout({
      sections: [
        { id: 'a', messageId: 'a1', preview: 'A', startY: 0, endY: 400 },
        { id: 'b', messageId: 'b1', preview: 'B', startY: 400, endY: 1400 },
        { id: 'c', messageId: 'c1', preview: 'C', startY: 1400, endY: 1900 },
        { id: 'd', messageId: 'd1', preview: 'D', startY: 1900, endY: 2400 },
      ],
      scrollTop: 760,
      scrollHeight: 2400,
      clientHeight: 600,
    });

    expect(layout.shown).toBe(true);
    expect(layout.markers.filter((marker) => marker.active)).toEqual([
      expect.objectContaining({ id: 'b' }),
    ]);
    expect(layout.markers.map((marker) => marker.position)).toEqual([
      0,
      1 / 6,
      7 / 12,
      19 / 24,
    ]);
  });

  it('同屏出现多个章节时只把阅读线所属章节标为 current', () => {
    const layout = resolveChatMinimapLayout({
      sections: [
        { id: 'a', messageId: 'a1', preview: 'A', startY: 0, endY: 500 },
        { id: 'b', messageId: 'b1', preview: 'B', startY: 500, endY: 900 },
        { id: 'c', messageId: 'c1', preview: 'C', startY: 900, endY: 1300 },
        { id: 'd', messageId: 'd1', preview: 'D', startY: 1300, endY: 1800 },
      ],
      scrollTop: 420,
      scrollHeight: 1800,
      clientHeight: 600,
    });

    expect(layout.markers.filter((marker) => marker.visible)).toHaveLength(3);
    expect(layout.markers.filter((marker) => marker.active)).toEqual([
      expect.objectContaining({ id: 'b' }),
    ]);
  });

  it('抵达滚动边界时稳定选中首尾章节', () => {
    const sections = [
      { id: 'a', messageId: 'a1', preview: 'A', startY: 24, endY: 800 },
      { id: 'b', messageId: 'b1', preview: 'B', startY: 800, endY: 1600 },
      { id: 'c', messageId: 'c1', preview: 'C', startY: 1600, endY: 2100 },
      { id: 'd', messageId: 'd1', preview: 'D', startY: 2100, endY: 2400 },
    ];

    const first = resolveChatMinimapLayout({
      sections,
      scrollTop: 0,
      scrollHeight: 2400,
      clientHeight: 600,
    });
    const last = resolveChatMinimapLayout({
      sections,
      scrollTop: 1800,
      scrollHeight: 2400,
      clientHeight: 600,
    });

    expect(first.markers.find((marker) => marker.active)?.id).toBe('a');
    expect(last.markers.find((marker) => marker.active)?.id).toBe('d');
  });
});
