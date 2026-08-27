/**
 * Callout 生成端联测 canary（Issue #477 AR08）。
 *
 * 门禁：仅在 MODEL_GATEWAY_API_KEY 存在时运行（本地 .env 已配置
 * openai-compatible provider）；无 key 环境整组跳过，不伪造证据。
 * 模型输出有随机性，断言只锁「语法合法」不锁「内容措辞」：
 * 1. 输出过公开 Schema（结构化生成管线本身已保证）；
 * 2. 产物含至少一个受支持类型的 callout 标记；
 * 3. 不出现未知类型（渲染层会降级，但 prompt 应引导模型不越界）。
 */
import { describe, expect, it } from 'vitest';
import { resolveStructuredModelGateway } from '../model-runtime.js';
import {
  generateMarkdownDocumentContent,
  MARKDOWN_DOCUMENT_PROMPT_VERSION,
} from './markdown-document-generation.js';

const suite = process.env.MODEL_GATEWAY_API_KEY ? describe : describe.skip;

suite('callout 生成端联测（真实模型）', () => {
  it(
    'prompt v2 引导模型产出受支持的 callout 标记',
    { timeout: 120_000 },
    async () => {
      const gateway = resolveStructuredModelGateway();
      expect(gateway).not.toBeNull();

      const messages = [
        {
          role: 'user' as const,
          content:
            'Python 里为什么不能写 def add(x, []) 这种默认参数？我昨天这么写被同事说有坑。',
        },
        {
          role: 'assistant' as const,
          content:
            '默认参数在函数定义时求值一次并绑定到函数对象，可变默认值会被所有调用共享。' +
            '常见正确写法是默认 None，函数体内 x = x if x is not None else []。' +
            '这个坑在配置对象、缓存字典场景尤其隐蔽。',
        },
      ];

      const { content } = await generateMarkdownDocumentContent({
        title: 'Python 可变默认参数的陷阱',
        messages,
        gateway,
        traceId: `canary-callout-${Date.now()}`,
        operationId: '00000000-0000-4000-8000-000000000001',
      });

      /* Schema 已由 generateStructured 内部校验；这里只验证 callout 语义 */
      const markers = [
        ...content.markdown.matchAll(/^>?[ \t]*\[!([a-zA-Z]+)\]/gm),
      ].map((match) => match[1]!.toLowerCase());
      expect(
        markers.length,
        `应产出 callout，实际：${content.markdown.slice(0, 400)}`,
      ).toBeGreaterThan(0);

      const supported = new Set([
        'note',
        'info',
        'todo',
        'tip',
        'success',
        'question',
        'warning',
        'danger',
        'failure',
        'bug',
        'example',
        'quote',
      ]);
      const unknown = markers.filter((type) => !supported.has(type));
      expect(unknown, `未知 callout 类型：${unknown.join(', ')}`).toEqual([]);
    },
  );

  it('prompt 版本常量已升级到 v2（防回退到无 callout 约定的 v1）', () => {
    expect(MARKDOWN_DOCUMENT_PROMPT_VERSION).toBe(
      'artifact-markdown-document-v2',
    );
  });
});
