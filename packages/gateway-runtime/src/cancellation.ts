/**
 * 进程内操作取消登记表。协作式取消：每个正在运行的操作在开始消费 runner 前
 * 登记一个 AbortController；`GatewayService.requestCancel` 触发对应信号后，
 * 消费循环在下一个事件边界（或正在 await 的 runner 被打断时）观察到中止，
 * 追加 `operation.cancelled` 并停止。
 *
 * 本表只负责低延迟打断当前进程；取消事实始终先写PostgreSQL。跨进程
 * continuation由Worker heartbeat/结算读取持久请求，本登记表不承担事实源职责。
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
