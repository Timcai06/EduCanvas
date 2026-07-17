import { flashcardsContentSchema } from '@educanvas/canvas-protocol';
import { describe, expect, it } from 'vitest';
import {
  FLASHCARDS_RULE_GENERATOR,
  buildRuleFlashcards,
  generateFlashcardsContent,
} from './flashcards-generation';

describe('buildRuleFlashcards', () => {
  it('问答对折叠为卡片并过公开 Schema', () => {
    const content = buildRuleFlashcards([
      { role: 'user', content: '什么是神经网络?' },
      { role: 'assistant', content: '由神经元分层组成的模型。' },
    ]);
    expect(content.cards[0]).toMatchObject({
      front: '什么是神经网络?',
      back: '由神经元分层组成的模型。',
    });
    expect(flashcardsContentSchema.safeParse(content).success).toBe(true);
  });

  it('无问答对时给占位说明卡,仍合法', () => {
    const content = buildRuleFlashcards([]);
    expect(content.cards).toHaveLength(1);
    expect(flashcardsContentSchema.safeParse(content).success).toBe(true);
  });

  it('卡片数封顶 40', () => {
    const many = Array.from({ length: 120 }, (_, index) => [
      { role: 'user' as const, content: `问题${index}` },
      { role: 'assistant' as const, content: `答案${index}` },
    ]).flat();
    const content = buildRuleFlashcards(many);
    expect(content.cards.length).toBeLessThanOrEqual(40);
  });
});

describe('generateFlashcardsContent', () => {
  it('网关未配置走规则版并标记溯源', async () => {
    const result = await generateFlashcardsContent({
      title: '复习闪卡',
      messages: [],
      gateway: null,
      traceId: 't',
      operationId: 'j',
    });
    expect(result.generatedBy).toBe(FLASHCARDS_RULE_GENERATOR);
  });
});
