import type { Runner } from 'graphile-worker';

const shutdownSignals = [
  'SIGUSR2',
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
  'SIGABRT',
] as const satisfies readonly NodeJS.Signals[];

interface SignalTarget {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

/**
 * 首个终止信号转为Runner优雅停止；随即移除监听，让第二个信号保留系统强制退出语义。
 */
export function installWorkerShutdownHandlers(input: {
  runner: Pick<Runner, 'stop'>;
  target?: SignalTarget;
  onSignal?: (signal: NodeJS.Signals) => void;
  onError?: (error: unknown) => void;
}): () => void {
  const target = input.target ?? process;
  let active = true;
  const listeners = new Map<NodeJS.Signals, () => void>();
  const remove = () => {
    if (!active) return;
    active = false;
    for (const [signal, listener] of listeners) {
      target.off(signal, listener);
    }
  };
  for (const signal of shutdownSignals) {
    const listener = () => {
      if (!active) return;
      remove();
      input.onSignal?.(signal);
      void input.runner
        .stop()
        .catch((error: unknown) => input.onError?.(error));
    };
    listeners.set(signal, listener);
    target.once(signal, listener);
  }
  return remove;
}
