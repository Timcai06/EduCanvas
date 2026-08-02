import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationArtifactCard } from './conversation-artifact-card';
import type { MessageArtifactDTO } from './messages';

const artifact: MessageArtifactDTO = {
  id: 'artifact-1',
  kind: 'mind_map',
  title: '函数思维导图',
  status: 'proposed',
  latestVersion: 0,
};

describe('ConversationArtifactCard', () => {
  it('提供稳定的产物打开名称和生成状态', () => {
    const html = renderToStaticMarkup(
      ConversationArtifactCard({ artifact, onOpen: vi.fn() }),
    );

    expect(html).toContain('aria-label="打开产物：函数思维导图"');
    expect(html).toContain('思维导图');
    expect(html).toContain('正在生成');
  });

  it('每次点击都使用同一 Artifact ID 重新打开 Canvas', () => {
    const onOpen = vi.fn();
    const element = ConversationArtifactCard({
      artifact: { ...artifact, status: 'active', latestVersion: 2 },
      onOpen,
    }) as ReactElement<{ onClick: () => void }>;

    element.props.onClick();
    element.props.onClick();

    expect(onOpen).toHaveBeenNthCalledWith(1, 'artifact-1');
    expect(onOpen).toHaveBeenNthCalledWith(2, 'artifact-1');
  });
});
