import type {
  TurnApplicationCommand,
  TurnApplicationEvent,
} from '@educanvas/agent-core';

/**
 * 三类入口共享的唯一 Turn 应用边界。
 * 调用方必须先完成服务端身份/Notebook 路由；实现方只能返回 transport-neutral 事件。
 */
export interface TurnApplicationPort {
  run(command: TurnApplicationCommand): AsyncIterable<TurnApplicationEvent>;
}
