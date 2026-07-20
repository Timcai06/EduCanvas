/**
 * 进程内操作取消登记表。协作式取消：每个正在运行的操作在开始消费 runner 前
 * 登记一个 AbortController；`GatewayService.requestCancel` 触发对应信号后，
 * 消费循环在下一个事件边界（或正在 await 的 runner 被打断时）观察到中止，
 * 追加 `operation.cancelled` 并停止。
 *
 * 之所以放在内存而非数据库：取消是"打断正在本进程运行的循环"这一实时动作，
 * 只对当前持有该操作循环的进程有意义（模块化单体单进程，每用户逻辑隔离，
 * 符合 ADR-0016 的控制平面边界）。跨进程/已落库的历史操作用 resume 回看，
 * 不通过取消登记表。
 */
export class GatewayCancellationRegistry {
  private readonly controllers = new Map<string, AbortController>();

  /** 登记一个运行中操作，返回其中止信号；同一 id 重复登记会覆盖旧 controller。 */
  register(operationId: string): AbortSignal {
    const controller = new AbortController();
    this.controllers.set(operationId, controller);
    return controller.signal;
  }

  /** 操作循环结束后必须释放，避免登记表随长会话无界增长。 */
  release(operationId: string): void {
    this.controllers.delete(operationId);
  }

  /** 触发中止；返回是否命中一个正在本进程运行的操作。 */
  cancel(operationId: string): boolean {
    const controller = this.controllers.get(operationId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /** 该操作是否正在本进程运行。 */
  isActive(operationId: string): boolean {
    return this.controllers.has(operationId);
  }
}
