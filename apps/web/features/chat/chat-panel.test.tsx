import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './chat-panel';
import type { ChatMessage, WebMessageCitationDTO } from './messages';

vi.mock('@gsap/react', () => ({ useGSAP: () => undefined }));

const citation: WebMessageCitationDTO = {
  id: 'citation-1',
  kind: 'web',
  marker: 1,
  label: '研究网页',
  assetId: 'asset-1',
  assetVersionId: 'version-1',
  url: 'https://example.com/research',
  pageStart: null,
  pageEnd: null,
};

function renderCitation(onOpenSource?: (assetId: string) => void): string {
  const messages: readonly ChatMessage[] = [
    {
      id: 'assistant-research',
      turnId: 'turn-research',
      clientMessageId: 'client-research',
      role: 'assistant',
      status: 'completed',
      text: '结论 [1]',
      attachments: [],
      citations: [citation],
    },
  ];
  return renderToStaticMarkup(
    <ChatPanel
      messages={messages}
      canvasOpen={false}
      artifactTitle=""
      onOpenCanvas={vi.fn()}
      onContinueText={vi.fn()}
      onRetry={vi.fn()}
      onOpenSource={onOpenSource}
    />,
  );
}

describe('ChatPanel web citations', () => {
  it('同时提供 Notebook Source 和原网页两个独立动作', () => {
    const html = renderCitation(vi.fn());

    expect(html).toContain('aria-label="打开来源 研究网页"');
    expect(html).toContain('title="在当前笔记本中打开来源"');
    expect(html).toContain('打开来源');
    expect(html).toContain('href="https://example.com/research"');
    expect(html).toContain('aria-label="打开原网页 研究网页"');
    expect(html).toContain('title="打开原网页"');
  });

  it('缺少 Notebook Source 回调时仍保留安全的原网页外链', () => {
    const html = renderCitation();

    expect(html).not.toContain('打开来源');
    expect(html).toContain('href="https://example.com/research"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('aria-label="打开原网页 研究网页"');
  });
});
