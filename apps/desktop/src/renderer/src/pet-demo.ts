import type { PetEvent, PetState } from '../../shared/pet-state';

const DEMO_SEQUENCE: Array<[PetState, PetEvent, number]> = [
  ['listen', 'listen_done', 800],
  ['think', 'think_done', 1000],
  ['speak', 'speak_done', 1500],
  ['success', 'demo_reset', 600],
];

/**
 * P1 演示时序：idle 点击后走 listen → think → speak → success → idle。
 * 每步先核对当前状态仍是目标状态（用户 cancel 后跳过后续事件）。
 * 返回取消函数；P2 换真实语音事件流时替换此模块。
 */
export function runDemo(
  emit: (event: PetEvent) => void,
  getState: () => PetState,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let acc = 0;
  for (const [target, event, delay] of DEMO_SEQUENCE) {
    acc += delay;
    timers.push(
      setTimeout(() => {
        if (getState() === target) emit(event);
      }, acc),
    );
  }
  return () => {
    timers.forEach(clearTimeout);
    timers.length = 0;
  };
}
