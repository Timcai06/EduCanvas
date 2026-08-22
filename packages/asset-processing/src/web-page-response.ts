import { WebPageError } from './web-page-security';

export function createCombinedAbortSignal(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onExternalAbort = () => {
    controller.abort(
      externalSignal?.reason ??
        new DOMException('The operation was aborted', 'AbortError'),
    );
  };
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('The operation timed out', 'TimeoutError'),
      ),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    },
  };
}

export async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (signal?.aborted) {
    throw (
      signal.reason ??
      new DOMException('The operation was aborted', 'AbortError')
    );
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    await discardResponse(response);
    throw new WebPageError('link_page_too_large');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const onAbort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal?.aborted) {
        throw (
          signal.reason ??
          new DOMException('The operation was aborted', 'AbortError')
        );
      }
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new WebPageError('link_page_too_large');
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}
