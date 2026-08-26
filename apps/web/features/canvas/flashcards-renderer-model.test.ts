import { describe, expect, it } from 'vitest';
import {
  applyMark,
  countMarks,
  createShuffledOrder,
  resolveFlashcardAction,
} from './flashcards-renderer-model';

describe('resolveFlashcardAction', () => {
  it('Space 与 Enter 恒翻面，与翻面态无关', () => {
    expect(resolveFlashcardAction(' ', false)).toBe('flip');
    expect(resolveFlashcardAction('Enter', true)).toBe('flip');
  });

  it('数字键只在翻开后生效（没看到答案就评分是无效输入）', () => {
    expect(resolveFlashcardAction('1', false)).toBeNull();
    expect(resolveFlashcardAction('2', false)).toBeNull();
    expect(resolveFlashcardAction('1', true)).toBe('missed');
    expect(resolveFlashcardAction('2', true)).toBe('got');
  });

  it('其他按键一律忽略', () => {
    expect(resolveFlashcardAction('ArrowRight', true)).toBeNull();
    expect(resolveFlashcardAction('Escape', false)).toBeNull();
  });
});

describe('createShuffledOrder', () => {
  it('是 0..n-1 的一个排列', () => {
    const order = createShuffledOrder(8, () => 0.42);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('rng 注入保证结果可复现', () => {
    const a = createShuffledOrder(6, () => 0.3);
    const b = createShuffledOrder(6, () => 0.3);
    expect(a).toEqual(b);
  });

  it('恒定 rng=0 时结果确定且仍是排列', () => {
    /* rng=0 → j 恒为 0：每轮把末位换到首位，得到 [1,2,3,0] */
    expect(createShuffledOrder(4, () => 0)).toEqual([1, 2, 3, 0]);
  });
});

describe('marks 记账', () => {
  it('applyMark 以卡 id 为键且不可变替换', () => {
    const first = applyMark({}, 'card-a', 'got');
    const second = applyMark(first, 'card-b', 'missed');
    expect(second).toEqual({ 'card-a': 'got', 'card-b': 'missed' });
    /* 旧对象不被原地修改 */
    expect(first).toEqual({ 'card-a': 'got' });
  });

  it('重复评分覆盖旧值；countMarks 只统计指定档', () => {
    let marks = applyMark({}, 'card-a', 'missed');
    marks = applyMark(marks, 'card-a', 'got');
    expect(countMarks(marks, 'got')).toBe(1);
    expect(countMarks(marks, 'missed')).toBe(0);
  });
});
