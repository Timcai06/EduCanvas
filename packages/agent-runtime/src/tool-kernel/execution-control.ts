/** @internal Adapter超过注册时限时使用的稳定内部标记。 */
export class ToolTimeoutError extends Error {}
/** @internal 上游取消到达Adapter执行边界时使用的稳定内部标记。 */
export class ToolCancelledError extends Error {}

/** @internal 单次Adapter调用共享的超时、取消与清理句柄。 */
export interface ExecutionControl {
  signal: AbortSignal;
  timeout: Promise<never>;
  cancellation: Promise<never>;
  dispose(): void;
}

/** Adapter超时与上游取消共享同一个AbortSignal，但返回不同稳定语义。 */
export function createExecutionControl(
  timeoutMs: number,
  upstream?: ModelAbortSignal,
): ExecutionControl {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectCancellation: (error: Error) => void = () => undefined;
  const cancellation = new Promise<never>((_, reject) => {
    rejectCancellation = reject;
  });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort('timeout');
      reject(new ToolTimeoutError());
    }, timeoutMs);
  });
  const cancel = () => {
    controller.abort('cancelled');
    rejectCancellation(new ToolCancelledError());
  };
  if (upstream?.aborted) cancel();
  else upstream?.addEventListener('abort', cancel, { once: true });
  return {
    signal: controller.signal,
    timeout,
    cancellation,
    dispose() {
      clearTimeout(timer);
      upstream?.removeEventListener('abort', cancel);
      controller.abort('execution_finished');
    },
  };
}
import type { ModelAbortSignal } from '@educanvas/agent-core';
