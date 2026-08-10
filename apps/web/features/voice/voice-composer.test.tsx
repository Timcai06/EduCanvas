import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { VoiceComposerRuntime } from './voice-composer';

const healthyChecks = [
  { key: 'model' as const, healthy: true },
  { key: 'connection' as const, healthy: true },
  { key: 'consent' as const, healthy: true },
  { key: 'retention' as const, healthy: true },
  { key: 'deletion-worker' as const, healthy: true },
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
  it('SSR 初始渲染显示两种模式但不触碰浏览器 runtime', () => {
    const result = render();
    expect(result.html).toContain('短句');
    expect(result.html).toContain('课堂字幕');
    expect(result.html).toContain('aria-label="开始语音输入"');
    expect(result.createCapture).not.toHaveBeenCalled();
    expect(result.createClient).not.toHaveBeenCalled();
  });

  it('缺同意时入口禁用且原因可读', () => {
    const result = render(
      healthyChecks.map((check) =>
        check.key === 'consent' ? { ...check, healthy: false } : check,
      ),
    );
    expect(result.html).toContain('disabled=""');
    expect(result.html).toContain('需要有效的监护人同意才能使用语音');
  });
});
