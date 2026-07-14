import { describe, expect, it } from 'vitest';
import { defaultToolPolicy, isToolAllowed } from './tools';

describe('状态工具白名单', () => {
  it('允许状态内的受控工具', () => {
    expect(isToolAllowed('EXPLAIN', 'renderCanvas')).toBe(true);
    expect(isToolAllowed('PRACTICE', 'gradeAnswer')).toBe(true);
    expect(isToolAllowed('ASSESS', 'recommendNextNode')).toBe(true);
  });

  it('拒绝状态外工具', () => {
    expect(isToolAllowed('EXPLAIN', 'gradeAnswer')).toBe(false);
    expect(isToolAllowed('DEMONSTRATE', 'recommendNextNode')).toBe(false);
  });

  it('默认策略在运行时不可被适配器篡改', () => {
    expect(Object.isFrozen(defaultToolPolicy)).toBe(true);
    expect(Object.isFrozen(defaultToolPolicy.ASSESS)).toBe(true);
  });
});
