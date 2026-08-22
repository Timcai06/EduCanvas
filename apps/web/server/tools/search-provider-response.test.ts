import { describe, expect, it, vi } from 'vitest';
import { SEARCH_PROVIDER_MAX_RESPONSE_BYTES } from './search-contract';
import { readSearchProviderJson } from './search-provider-response';

describe('readSearchProviderJson', () => {
  it('cancels a body rejected by the declared byte budget', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: {
        'content-length': String(SEARCH_PROVIDER_MAX_RESPONSE_BYTES + 1),
      },
    });

    await expect(readSearchProviderJson(response)).rejects.toMatchObject({
      code: 'search_invalid_response',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('actively cancels a blocked reader when the provider request aborts', async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    const pending = readSearchProviderJson(
      new Response(
        new ReadableStream({
          pull: () => new Promise(() => undefined),
          cancel,
        }),
      ),
      controller.signal,
    );
    await Promise.resolve();
    controller.abort(new DOMException('cancelled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
