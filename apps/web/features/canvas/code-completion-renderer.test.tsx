import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CodeCompletionRenderer } from './code-completion-renderer';

describe('CodeCompletionRenderer', () => {
  it('展示预置代码、运行入口和有界沙箱说明', () => {
    const html = renderToStaticMarkup(
      <CodeCompletionRenderer
        artifact={{
          schemaVersion: '1',
          artifactId: 'code-1',
          type: 'code_completion',
          title: '补全平均值',
          params: {
            language: 'python',
            prompt: '补全关键行',
            starterCode: 'average = ___',
          },
        }}
        disabled={false}
        feedback={null}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('average = ___');
    expect(html).toContain('运行代码');
    expect(html).toContain('提交答案');
    expect(html).toContain('无网络 · 最长运行 3 秒');
    expect(html).not.toContain('requiredLine');
  });
});
