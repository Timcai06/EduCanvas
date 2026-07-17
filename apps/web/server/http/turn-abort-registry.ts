import 'server-only';

interface AbortRegistryState {
  controllers: Map<string, AbortController>;
}

const globalWithAbortRegistry = globalThis as typeof globalThis & {
  __educanvasTurnAbortRegistry?: AbortRegistryState;
};

const state =
  globalWithAbortRegistry.__educanvasTurnAbortRegistry ??
  (globalWithAbortRegistry.__educanvasTurnAbortRegistry = {
    controllers: new Map(),
  });

/**
 * 注册当前实例正在消费的 Provider Turn。数据库取消事实仍是权威来源；
 * 该表只用于让同一 Node 实例立即向 fetch 传播 Abort。
 */
export function registerTurnAbortController(
  turnId: string,
  controller: AbortController,
): () => void {
  const existing = state.controllers.get(turnId);
  if (existing && existing !== controller && !existing.signal.aborted) {
    throw new Error('turn_abort_controller_already_registered');
  }
  state.controllers.set(turnId, controller);
  return () => {
    if (state.controllers.get(turnId) === controller) {
      state.controllers.delete(turnId);
    }
  };
}

/** 返回 false 表示目标 Turn 不在当前实例；取消事实仍已由数据库记录。 */
export function abortRegisteredTurn(turnId: string): boolean {
  const controller = state.controllers.get(turnId);
  if (!controller) return false;
  if (!controller.signal.aborted) controller.abort('explicit_student_stop');
  return true;
}
