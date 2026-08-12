import { describe, expect, it } from 'vitest';
import { LiveInterruptionCoordinator } from './live-interruption-coordinator';

interface FixtureContext {
  readonly context: string;
}

describe('live interruption coordinator', () => {
  it('空闲态下 latest final 直接提交，且去重防止重复回调', () => {
    const coordinator = new LiveInterruptionCoordinator<FixtureContext>();
    const generation = coordinator.beginAsrTurn();

    expect(
      coordinator.onAsrFinal({
        generation,
        text: '你好，我想问',
        context: { context: 'A' },
      }),
    ).toEqual([
      {
        type: 'submit',
        generation,
        text: '你好，我想问',
        context: { context: 'A' },
      },
    ]);
    expect(
      coordinator.onAsrFinal({
        generation,
        text: '你好，我想问（重复）',
        context: { context: 'A2' },
      }),
    ).toEqual([]);
    expect(coordinator.getState().pendingFinal).toBeNull();
  });

  it('忙态插话时先作废本地旧语音、对当前 turn 只 cancel 一次并排队最新 final', () => {
    const coordinator = new LiveInterruptionCoordinator<FixtureContext>();
    const g1 = coordinator.beginAsrTurn();
    expect(
      coordinator.setBusy({ busy: true, turnId: 'assistant-old' }),
    ).toEqual([]);

    const first = coordinator.onAsrFinal({
      generation: g1,
      text: '先打断',
      context: { context: 'first' },
    });
    expect(first).toEqual([{ type: 'cancel-agent', turnId: 'assistant-old' }]);
    expect(coordinator.getState().pendingFinal).toMatchObject({
      generation: g1,
      text: '先打断',
      busyTurnId: 'assistant-old',
    });

    const g2 = coordinator.beginAsrTurn();
    const second = coordinator.onAsrFinal({
      generation: g2,
      text: '后到 final',
      context: { context: 'second' },
    });
    expect(second).toEqual([]);
    expect(coordinator.getState().pendingFinal).toMatchObject({
      generation: g2,
      text: '后到 final',
      busyTurnId: 'assistant-old',
    });

    const duplicate = coordinator.onAsrFinal({
      generation: g2,
      text: '重复回调',
      context: { context: 'dup' },
    });
    expect(duplicate).toEqual([]);

    const finish = coordinator.setBusy({ busy: false, turnId: null });
    expect(finish).toEqual([
      {
        type: 'submit',
        generation: g2,
        text: '后到 final',
        context: { context: 'second' },
      },
    ]);
  });

  it('迟到回调不能取消新 turn，generation 变化会使旧回调失效', () => {
    const coordinator = new LiveInterruptionCoordinator<FixtureContext>();
    const first = coordinator.beginAsrTurn();
    coordinator.setBusy({ busy: true, turnId: 'assistant-A' });

    expect(
      coordinator.onAsrFinal({
        generation: first,
        text: '旧回调',
        context: { context: 'stale' },
      }),
    ).toEqual([{ type: 'cancel-agent', turnId: 'assistant-A' }]);

    const second = coordinator.beginAsrTurn();
    expect(
      coordinator.setBusy({
        busy: true,
        turnId: 'assistant-B',
      }),
    ).toEqual([]);
    coordinator.onAsrFinal({
      generation: second,
      text: '新回调',
      context: { context: 'new' },
    });

    expect(
      coordinator.onAsrFinal({
        generation: first,
        text: '旧回调晚到',
        context: { context: 'late-stale' },
      }),
    ).toEqual([]);

    const finish = coordinator.setBusy({
      busy: false,
      turnId: null,
    });
    // 仅应对最新 pending 生效；旧回调不能触发新的 cancel 或 submit。
    expect(finish).toEqual([
      {
        type: 'submit',
        generation: second,
        text: '新回调',
        context: { context: 'new' },
      },
    ]);
    expect(coordinator.getState().cancelIssuedForTurnId).toBeNull();
    expect(coordinator.getState().busyTurnId).toBeNull();
  });

  it('有效 partial 在 final 前取消当前 turn，final 不会重复取消', () => {
    const coordinator = new LiveInterruptionCoordinator<FixtureContext>();
    coordinator.setBusy({ busy: true, turnId: 'assistant-old' });
    expect(coordinator.onBargeIn()).toEqual([
      { type: 'cancel-agent', turnId: 'assistant-old' },
    ]);
    expect(coordinator.onBargeIn()).toEqual([]);

    const generation = coordinator.beginAsrTurn();
    expect(
      coordinator.onAsrFinal({
        generation,
        text: '新的问题',
        context: { context: 'next' },
      }),
    ).toEqual([]);
    expect(coordinator.getState().pendingFinal?.text).toBe('新的问题');
  });

  it('同一 turn 切换 busy 时会重置 cancel guard，允许对新 turn 再 cancel 一次', () => {
    const coordinator = new LiveInterruptionCoordinator<FixtureContext>();
    const first = coordinator.beginAsrTurn();
    coordinator.setBusy({ busy: true, turnId: 'assistant-1' });
    expect(
      coordinator.onAsrFinal({
        generation: first,
        text: 'A',
        context: { context: 'a' },
      }),
    ).toEqual([{ type: 'cancel-agent', turnId: 'assistant-1' }]);

    coordinator.setBusy({ busy: false, turnId: null });
    const second = coordinator.beginAsrTurn();
    coordinator.setBusy({ busy: true, turnId: 'assistant-2' });
    const secondActions = coordinator.onAsrFinal({
      generation: second,
      text: 'B',
      context: { context: 'b' },
    });
    expect(secondActions).toEqual([
      { type: 'cancel-agent', turnId: 'assistant-2' },
    ]);
  });
});
