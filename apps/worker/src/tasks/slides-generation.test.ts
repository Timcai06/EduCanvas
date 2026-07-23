import { slidesContentSchema } from '@educanvas/canvas-protocol';
import { describe, expect, it } from 'vitest';
import {
  SLIDES_RULE_GENERATOR,
  buildRuleSlides,
  generateSlidesContent,
} from './slides-generation';

const messages = [
  { role: 'user' as const, content: '什么是神经网络?' },
  {
    role: 'assistant' as const,
    content: '# 概念\n神经网络由神经元分层组成。\n- 权重学习特征\n- 层层抽象',
  },
];

describe('buildRuleSlides', () => {
  it('封面页恒存在,问答折叠为分页且过公开 Schema', () => {
    const content = buildRuleSlides('对话小结', messages);
    expect(content.slides[0]).toMatchObject({ id: 'cover', title: '对话小结' });
    expect(content.slides[1]?.title).toBe('什么是神经网络?');
    expect(content.slides[1]?.bullets.length).toBeGreaterThan(0);
    expect(slidesContentSchema.safeParse(content).success).toBe(true);
  });

  it('空对话只有封面页,仍是合法 Slides', () => {
    const content = buildRuleSlides('空对话', []);
    expect(content.slides).toHaveLength(1);
    expect(slidesContentSchema.safeParse(content).success).toBe(true);
  });

  it('页数封顶 20,超长要点被截断', () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      role: 'user' as const,
      content: `问题${index} ${'长'.repeat(300)}`,
    }));
    const content = buildRuleSlides('上限', many);
    expect(content.slides.length).toBeLessThanOrEqual(20);
    expect(slidesContentSchema.safeParse(content).success).toBe(true);
  });
});

describe('generateSlidesContent', () => {
  it('网关未配置走规则版并标记溯源', async () => {
    const result = await generateSlidesContent({
      title: '对话小结',
      messages,
      gateway: null,
      traceId: 't',
      operationId: 'j',
    });
    expect(result.generatedBy).toBe(SLIDES_RULE_GENERATOR);
  });
});
