import { describe, expect, it } from 'vitest';
import { toActivityViewModel } from './profile-activity-view-model';
import type { ActivityLoadState } from './learning-activity-loader';

import type { LearningActivity } from './activity-contract';

function readyState(): ActivityLoadState {
  const activity: LearningActivity = {
    days: [],
    totalSessions: 5,
    activeDays: 5,
    streakDays: 3,
    masteryPercent: 72,
  };
  return { kind: 'ready', activity };
}

function readyStateWith(
  overrides: Partial<LearningActivity>,
): ActivityLoadState {
  const base = readyState();
  if (base.kind !== 'ready') throw new Error('expected ready');
  return { kind: 'ready', activity: { ...base.activity, ...overrides } };
}

describe('toActivityViewModel', () => {
  // ---- loading ----
  it('loading → isBusy=true，统计值为 null，不显示消息', () => {
    const vm = toActivityViewModel({ kind: 'loading' });
    expect(vm.isBusy).toBe(true);
    expect(vm.isFailed).toBe(false);
    expect(vm.isEmpty).toBe(false);
    expect(vm.streakDays).toBeNull();
    expect(vm.activeDays).toBeNull();
    expect(vm.masteryPercent).toBeNull();
    expect(vm.message).toBeNull();
  });

  // ---- ready ----
  it('ready → isBusy=false，统计值从 activity 透出', () => {
    const vm = toActivityViewModel(readyState());
    expect(vm.isBusy).toBe(false);
    expect(vm.streakDays).toBe(3);
    expect(vm.activeDays).toBe(5);
    expect(vm.masteryPercent).toBe(72);
    expect(vm.message).toBeNull();
  });

  it('ready 且 mastery 为 null → masteryPercent 为 null', () => {
    const state = readyStateWith({ masteryPercent: null });
    const vm = toActivityViewModel(state);
    expect(vm.masteryPercent).toBeNull();
  });

  // ---- empty ----
  it('empty → isEmpty=true，统计为 null，不伪造数据', () => {
    const vm = toActivityViewModel({ kind: 'empty' });
    expect(vm.isEmpty).toBe(true);
    expect(vm.isBusy).toBe(false);
    expect(vm.isFailed).toBe(false);
    expect(vm.streakDays).toBeNull();
    expect(vm.activeDays).toBeNull();
    expect(vm.masteryPercent).toBeNull();
    expect(vm.message).toBe('还没有学习记录');
  });

  // ---- failed ----
  it('failed → isFailed=true，结束 busy，显示安全消息', () => {
    const vm = toActivityViewModel({ kind: 'failed', message: '' });
    expect(vm.isFailed).toBe(true);
    expect(vm.isBusy).toBe(false);
    expect(vm.isEmpty).toBe(false);
    expect(vm.streakDays).toBeNull();
    expect(vm.message).toBe('暂时无法加载学习活动');
  });

  it('failed.message 不暴露原始错误信息', () => {
    const vm = toActivityViewModel({
      kind: 'failed',
      message: 'connect ECONNREFUSED 127.0.0.1:5432',
    });
    // view model 应返回固定安全文案，不是 origin 传入的 message
    expect(vm.message).toBe('暂时无法加载学习活动');
    expect(vm.message).not.toContain('ECONNREFUSED');
  });

  // ---- 空活动 ready（activeDays=0 应该走 empty 分支，由 loader 保证） ----
  it('ready 但 activeDays=0 → 由 loader 转 empty；若直接进入仍展示统计', () => {
    const state = readyStateWith({ activeDays: 0, streakDays: 0 });
    const vm = toActivityViewModel(state);
    // view model 不做 empty 判断（loader 已处理），信任传入的 kind
    expect(vm.streakDays).toBe(0);
    expect(vm.activeDays).toBe(0);
    expect(vm.isBusy).toBe(false);
  });
});
