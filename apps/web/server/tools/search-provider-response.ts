import {
  SearchProviderError,
  SEARCH_PROVIDER_MAX_RESPONSE_BYTES,
} from './search-contract';

/** Provider JSON is untrusted input; consume it through a bounded stream only. */
export async function readSearchProviderJson(
  response: Response,
  signal?: AbortSignal,
): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > SEARCH_PROVIDER_MAX_RESPONSE_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new SearchProviderError('search_invalid_response', false);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new SearchProviderError('search_invalid_response', false);
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const onAbort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      byteLength += value.byteLength;
      if (byteLength > SEARCH_PROVIDER_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new SearchProviderError('search_invalid_response', false);
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new SearchProviderError('search_invalid_response', false);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new SearchProviderError('search_invalid_response', false);
    }
  } catch (error) {
    if (signal?.aborted) {
      throw (
        signal.reason ??
        new DOMException('The operation was aborted', 'AbortError')
      );
    }
    if (error instanceof SearchProviderError) throw error;
    throw new SearchProviderError('search_invalid_response', false);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}
