import { describe, expect, it } from 'vitest';
import {
  beginInterruption,
  evaluateTransition,
  resolveTransitionCandidate,
  resumeInterruption,
  selectInitialState,
  type TeachingState,
} from './state-machine';

const transition = (
  from: TeachingState,
  to: TeachingState,
  overrides: Partial<Parameters<typeof evaluateTransition>[0]> = {},
) =>
  evaluateTransition({
    from,
    to,
    practiceEventCount: 1,
    minimumPracticeEvents: 1,
    ...overrides,
  });

describe('教学状态机', () => {
  it('根据掌握记录显式选择初始状态', () => {
    expect(selectInitialState(false)).toBe('DIAGNOSE');
    expect(selectInitialState(true)).toBe('EXPLAIN');
  });

  it('允许五状态脊柱的合法前进', () => {
    expect(transition('DIAGNOSE', 'EXPLAIN').ok).toBe(true);
    expect(transition('EXPLAIN', 'DEMONSTRATE').ok).toBe(true);
    expect(transition('DEMONSTRATE', 'PRACTICE').ok).toBe(true);
    expect(transition('PRACTICE', 'ASSESS').ok).toBe(true);
  });

  it('拒绝跳过教学环节', () => {
    expect(transition('DIAGNOSE', 'PRACTICE')).toMatchObject({
      ok: false,
      code: 'ILLEGAL_TRANSITION',
    });
    expect(transition('EXPLAIN', 'ASSESS')).toMatchObject({
      ok: false,
      code: 'ILLEGAL_TRANSITION',
    });
  });

  it('候选信号不能携带目标状态并且只能推进当前相邻阶段', () => {
    expect(
      resolveTransitionCandidate('DIAGNOSE', 'DIAGNOSIS_COMPLETED'),
    ).toEqual({
      ok: true,
      kind: 'STATE_TARGET',
      from: 'DIAGNOSE',
      to: 'EXPLAIN',
    });
    expect(
      resolveTransitionCandidate('DIAGNOSE', 'PRACTICE_COMPLETED'),
    ).toMatchObject({
      ok: false,
      code: 'CANDIDATE_NOT_APPLICABLE',
    });
    expect(
      resolveTransitionCandidate('ASSESS', 'ASSESSMENT_COMPLETED'),
    ).toEqual({ ok: true, kind: 'ASSESSMENT_EXIT', from: 'ASSESS' });
  });

  it('证据不足时拒绝从PRACTICE进入ASSESS', () => {
    expect(
      transition('PRACTICE', 'ASSESS', {
        practiceEventCount: 1,
        minimumPracticeEvents: 2,
      }),
    ).toMatchObject({ ok: false, code: 'INSUFFICIENT_PRACTICE' });
  });

  it('拒绝负数练习证据', () => {
    expect(() =>
      transition('PRACTICE', 'ASSESS', {
        practiceEventCount: -1,
      }),
    ).toThrow();
  });

  it('ASSESS只有REMEDIATE可以返回讲解或练习', () => {
    expect(
      transition('ASSESS', 'EXPLAIN', { assessmentDecision: 'REMEDIATE' }),
    ).toMatchObject({ ok: true });
    expect(
      transition('ASSESS', 'PRACTICE', { assessmentDecision: 'ADVANCE' }),
    ).toMatchObject({ ok: false, code: 'ADVANCE_HAS_NO_TARGET_STATE' });
    expect(transition('ASSESS', 'EXPLAIN')).toMatchObject({
      ok: false,
      code: 'ASSESSMENT_DECISION_REQUIRED',
    });
  });

  it('中断栈深度固定为1并能恢复原状态', () => {
    const started = beginInterruption({
      state: 'DEMONSTRATE',
      interruptedState: null,
    });
    expect(started).toMatchObject({
      ok: true,
      cursor: { state: 'DEMONSTRATE', interruptedState: 'DEMONSTRATE' },
    });
    if (!started.ok) throw new Error('测试前置条件失败');

    expect(beginInterruption(started.cursor)).toEqual({
      ok: false,
      code: 'INTERRUPTION_ALREADY_ACTIVE',
    });
    expect(resumeInterruption(started.cursor)).toMatchObject({
      ok: true,
      cursor: { state: 'DEMONSTRATE', interruptedState: null },
    });
  });
});
