import { describe, expect, it } from 'vitest';
import { transition } from '../src/shared/pet-state';

const ALL_STATES = ['idle', 'listen', 'think', 'speak', 'success', 'error'];

describe('pet 状态机转换表', () => {
  const cases: Array<[string, string, string]> = [
    ['idle', 'pet_click', 'listen'],
    ['idle', 'cancel', 'idle'],
    ['idle', 'listen_done', 'idle'],
    ['listen', 'pet_click', 'idle'],
    ['listen', 'cancel', 'idle'],
    ['listen', 'listen_done', 'think'],
    ['think', 'pet_click', 'idle'],
    ['think', 'cancel', 'idle'],
    ['think', 'think_done', 'speak'],
    ['speak', 'pet_click', 'idle'],
    ['speak', 'cancel', 'idle'],
    ['speak', 'speak_done', 'success'],
    ['success', 'demo_reset', 'idle'],
    ['error', 'demo_reset', 'idle'],
    ['listen', 'demo_fail', 'error'],
    ['think', 'demo_fail', 'error'],
    ['speak', 'demo_fail', 'error'],
  ];
  for (const [s, e, expected] of cases) {
    it(`${s} + ${e} → ${expected}`, () => {
      expect(transition(s as never, e as never)).toBe(expected);
    });
  }

  it('未定义的事件保持原状态（失败安全）', () => {
    for (const s of ALL_STATES) {
      // demo_reset 只对 success/error 生效，其他状态保持
      expect(transition(s as never, 'demo_reset' as never)).toBe(
        s === 'success' || s === 'error' ? 'idle' : s,
      );
      // speak_done 只对 speak 生效
      expect(transition(s as never, 'speak_done' as never)).toBe(
        s === 'speak' ? 'success' : s,
      );
    }
  });

  it('终态不响应点击/取消（展示完成后才可回 idle）', () => {
    expect(transition('success', 'pet_click')).toBe('success');
    expect(transition('error', 'cancel')).toBe('error');
  });
});
