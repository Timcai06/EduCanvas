/**
 * 桌宠业务状态机（纯函数，spec §5）。
 * P1 演示：idle 点击启动 listen→think→speak→success 序列，交互中点击 = cancel。
 * P2 接真语音后 demo 事件换成 Voice/Agent 真实事件，转换表不变。
 */

export type PetState = 'idle' | 'listen' | 'think' | 'speak' | 'success' | 'error';
export type PetEvent =
  | 'pet_click'
  | 'cancel'
  | 'listen_done'
  | 'think_done'
  | 'speak_done'
  | 'demo_fail'
  | 'demo_reset';

const TABLE: Record<PetState, Partial<Record<PetEvent, PetState>>> = {
  idle: { pet_click: 'listen' },
  listen: { pet_click: 'idle', cancel: 'idle', listen_done: 'think', demo_fail: 'error' },
  think: { pet_click: 'idle', cancel: 'idle', think_done: 'speak', demo_fail: 'error' },
  speak: { pet_click: 'idle', cancel: 'idle', speak_done: 'success', demo_fail: 'error' },
  success: { demo_reset: 'idle' },
  error: { demo_reset: 'idle' },
};

/** 纯函数状态转换：未定义的事件保持原状态（失败安全）。 */
export function transition(state: PetState, event: PetEvent): PetState {
  return TABLE[state][event] ?? state;
}
