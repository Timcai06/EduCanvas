import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FlashcardsRenderer } from './flashcards-renderer';

const validContent = {
  contentVersion: 1,
  cards: [
    { id: 'card-a', front: '什么是过拟合？', back: '训练集表现好但泛化差。' },
    { id: 'card-b', front: '正则化的作用？', back: '约束模型复杂度。' },
  ],
};

describe('FlashcardsRenderer（静态标记契约）', () => {
  it('合法 content 渲染 data-flashcards 与正面问题、翻面提示芯片', () => {
    const html = renderToStaticMarkup(
      <FlashcardsRenderer content={validContent} />,
    );
    expect(html).toContain('data-flashcards');
    expect(html).toContain('什么是过拟合？');
    /* 答案在背面，但 DOM 中存在（backface 隐藏是视觉层的事） */
    expect(html).toContain('训练集表现好但泛化差。');
    expect(html).toContain('>Space<');
  });

  it('进度条与计数徽标随初始状态渲染', () => {
    const html = renderToStaticMarkup(
      <FlashcardsRenderer content={validContent} />,
    );
    expect(html).toContain('data-canvas-progress');
    expect(html).toContain('已记住');
    expect(html).toContain('1 / 2');
  });

  it('畸形 content 显示错误态而不是崩溃', () => {
    const html = renderToStaticMarkup(
      <FlashcardsRenderer content={{ contentVersion: 1, cards: 'oops' }} />,
    );
    expect(html).toContain('内容格式有问题');
  });
});
