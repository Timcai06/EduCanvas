import type { CanvasResource } from '@educanvas/canvas-protocol';
import { fetchCanvasResource } from '../canvas/canvas-resource-client';

function waitForNextPoll(signal: AbortSignal, delayMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      const error = new Error('source_resource_poll_aborted');
      error.name = 'AbortError';
      reject(error);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * processing Source 只轮询安全元数据；进入任一终态后立即返回，由 Renderer
 * 再决定是否懒加载正文。Abort 会同时停止计时器与当前 fetch。
 */
export async function pollSourceResource(input: {
  resourceId: string;
  signal: AbortSignal;
  delayMs?: number;
  load?: (resourceId: string, signal: AbortSignal) => Promise<CanvasResource>;
}): Promise<CanvasResource> {
  const load =
    input.load ??
    ((resourceId, signal) =>
      fetchCanvasResource('source', resourceId, { signal }));
  while (true) {
    await waitForNextPoll(input.signal, input.delayMs ?? 2_000);
    const resource = await load(input.resourceId, input.signal);
    if (resource.status !== 'processing') return resource;
  }
}
