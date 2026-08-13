import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildTurnContextSnapshot } from '@/features/chat/turn-context-snapshot';
import { TurnContextStrip } from './turn-context-strip';

describe('TurnContextStrip', () => {
  it('呈现与请求同源的冻结版本和明确省略原因', () => {
    const snapshot = buildTurnContextSnapshot([
      {
        id: 'ready-source',
        versionId: 'version-1',
        label: '函数讲义',
        kind: 'document',
        scope: 'space',
        status: 'ready',
        enabled: true,
        selectable: true,
      },
      {
        id: 'processing-source',
        versionId: null,
        label: '正在解析的资料',
        kind: 'document',
        scope: 'turn',
        status: 'processing',
        enabled: true,
        selectable: false,
      },
    ]);
    const html = renderToStaticMarkup(<TurnContextStrip snapshot={snapshot} />);
    expect(html).toContain('1 项将带入');
    expect(html).toContain('函数讲义 · 版本 version-1');
    expect(html).toContain('正在解析的资料：本轮未带入（处理中）');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('objectKey');
  });
});
