import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactDetail } from '@/features/canvas/artifact-client';
import type { ChatMessage, MessageArtifactDTO } from '@/features/chat/messages';
import {
  conversationArtifactReferences,
  createConversationArtifactObserver,
} from './conversation-artifact-observer';
import { applyObservedArtifact } from '@/features/chat/turn-state-messages';

const artifact = (id: string, kind = 'note'): MessageArtifactDTO => ({
  id,
  kind,
  title: id,
  status: 'proposed',
  latestVersion: 0,
});
const detail = (
  id: string,
  status: string,
  latestVersion = 0,
): ArtifactDetail =>
  ({
    artifact: { ...artifact(id), latestVersion },
    latestJob: { id: `job-${id}`, status },
  }) as ArtifactDetail;
const message = (artifacts: readonly MessageArtifactDTO[]): ChatMessage => ({
  id: 'assistant-1',
  turnId: 'turn-1',
  clientMessageId: 'client-1',
  role: 'assistant',
  status: 'completed',
  text: '',
  attachments: [],
  artifacts,
});

describe('conversation artifact request queue', () => {
  const observers: ReturnType<typeof createConversationArtifactObserver>[] = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    observers.forEach((observer) => observer.dispose());
    observers.length = 0;
    vi.useRealTimers();
  });
  function observer(
    fetchDetail: (id: string, signal: AbortSignal) => Promise<ArtifactDetail>,
    onObserved = vi.fn(),
  ) {
    const result = createConversationArtifactObserver({
      fetchDetail,
      onObserved,
    });
    observers.push(result);
    return result;
  }

  it('overlapping A/B complete independently and duplicate references share one request', async () => {
    let resolveA!: (value: ArtifactDetail) => void;
    const fetch = vi.fn((id: string) =>
      id === 'A'
        ? new Promise<ArtifactDetail>((resolve) => {
            resolveA = resolve;
          })
        : Promise.resolve(detail(id, 'failed')),
    );
    const observed = vi.fn();
    const queue = observer(fetch, observed);
    queue.sync([artifact('A'), artifact('A')]);
    await vi.advanceTimersByTimeAsync(0);
    queue.sync([artifact('A'), artifact('B')]);
    await vi.advanceTimersByTimeAsync(750);
    expect(observed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'B', status: 'failed' }),
    );
    resolveA(detail('A', 'failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'A', status: 'failed' }),
    );
    queue.sync([artifact('A'), artifact('B')]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('history running then failed and picturebook converge without SSE or Canvas', async () => {
    const references = conversationArtifactReferences([
      message([artifact('history'), artifact('picturebook', 'picturebook')]),
    ]);
    const attempts = new Map<string, number>();
    const fetch = vi.fn(async (id: string) => {
      const attempt = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, attempt);
      return detail(id, attempt === 1 ? 'running' : 'failed');
    });
    const observed = vi.fn();
    observer(fetch, observed).sync(references);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(observed.mock.calls.map(([value]) => value.id)).toEqual([
      'history',
      'picturebook',
    ]);
    expect(
      observed.mock.calls.every(([value]) => value.status === 'failed'),
    ).toBe(true);
  });

  it('shares two slots and a global start interval fairly across pending cards', async () => {
    const requests: {
      id: string;
      signal: AbortSignal;
      resolve: (value: ArtifactDetail) => void;
    }[] = [];
    const fetch = vi.fn(
      (id: string, signal: AbortSignal) =>
        new Promise<ArtifactDetail>((resolve) => {
          requests.push({ id, signal, resolve });
        }),
    );
    observer(fetch).sync(['A', 'B', 'C'].map((id) => artifact(id)));
    await vi.advanceTimersByTimeAsync(749);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    requests[0]!.resolve(detail('A', 'running'));
    await vi.advanceTimersByTimeAsync(0);
    expect(requests.map((request) => request.id)).toEqual(['A', 'B', 'C']);
  });

  it('network errors do not fabricate failed and disposal aborts only observation', async () => {
    let signal!: AbortSignal;
    const fetch = vi.fn(async (_id: string, requestSignal: AbortSignal) => {
      signal = requestSignal;
      throw new Error('network unavailable');
    });
    const observed = vi.fn();
    const queue = observer(fetch, observed);
    queue.sync([artifact('A')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(observed).not.toHaveBeenCalled();
    queue.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(false);
  });

  it('unmount aborts in-flight reads and ignores late durable results', async () => {
    let signal!: AbortSignal;
    let resolve!: (value: ArtifactDetail) => void;
    const observed = vi.fn();
    const queue = observer((_id, requestSignal) => {
      signal = requestSignal;
      return new Promise<ArtifactDetail>((next) => {
        resolve = next;
      });
    }, observed);
    queue.sync([artifact('A')]);
    await vi.advanceTimersByTimeAsync(0);
    queue.dispose();
    expect(signal.aborted).toBe(true);
    resolve(detail('A', 'cancelled'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(observed).not.toHaveBeenCalled();
  });

  it('request timeout releases a slot without claiming durable cancellation', async () => {
    const observed = vi.fn();
    const fetch = vi.fn(
      (_id: string, signal: AbortSignal) =>
        new Promise<ArtifactDetail>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    observer(fetch, observed).sync([artifact('A')]);
    await vi.advanceTimersByTimeAsync(16_500);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(observed).not.toHaveBeenCalled();
  });

  it('bounded window reports uncertainty and resume discovers a late terminal result', async () => {
    let status = 'running';
    const fetch = vi.fn(async (id: string) => detail(id, status));
    const observed = vi.fn();
    const queue = observer(fetch, observed);
    queue.sync([artifact('A')]);
    await vi.advanceTimersByTimeAsync(310_000);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(40);
    expect(observed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'proposed',
        observationTimedOut: true,
      }),
    );
    const calls = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(calls);
    status = 'failed';
    queue.sync([artifact('A')], true);
    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('focus refresh and proposed transitions invalidate terminal cache for new jobs', async () => {
    let status = 'failed';
    const observed = vi.fn();
    const queue = observer(async (id) => detail(id, status), observed);
    queue.sync([artifact('A')]);
    await vi.advanceTimersByTimeAsync(0);
    queue.sync([{ ...artifact('A'), status: 'failed' }]);
    status = 'running';
    queue.sync([{ ...artifact('A'), status: 'failed' }], true);
    await vi.advanceTimersByTimeAsync(750);
    expect(observed).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'proposed' }),
    );
    queue.sync([artifact('A')]);
    status = 'cancelled';
    await vi.advanceTimersByTimeAsync(2_000);
    expect(observed).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
    );
  });

  it('every occurrence of the same id receives its durable terminal status', () => {
    const messages = [
      message([artifact('A')]),
      { ...message([artifact('A')]), id: 'assistant-2' },
    ];
    expect(conversationArtifactReferences(messages)).toHaveLength(1);
    const next = applyObservedArtifact(messages, {
      ...artifact('A'),
      status: 'failed',
    });
    expect(
      next.every(
        (value) =>
          value.role === 'assistant' &&
          value.artifacts?.[0]?.status === 'failed',
      ),
    ).toBe(true);
  });

  it('a proposed retry invalidates an in-flight old failed read and releases its slot', async () => {
    let resolveOld!: (value: ArtifactDetail) => void;
    let oldSignal!: AbortSignal;
    let callsForA = 0;
    const fetch = vi.fn((id: string, signal: AbortSignal) => {
      if (id === 'B') return new Promise<ArtifactDetail>(() => {});
      callsForA += 1;
      if (callsForA === 1) {
        oldSignal = signal;
        return new Promise<ArtifactDetail>((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve(
        detail(id, callsForA === 2 ? 'running' : 'cancelled'),
      );
    });
    const observed = vi.fn();
    const queue = observer(fetch, observed);
    queue.sync([{ ...artifact('A'), status: 'failed' }, artifact('B')], true);
    await vi.advanceTimersByTimeAsync(750);
    expect(fetch).toHaveBeenCalledTimes(2);
    queue.sync([artifact('A'), artifact('B')]);
    expect(oldSignal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(750);
    expect(callsForA).toBe(2);
    resolveOld(detail('A', 'failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(observed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(observed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'A',
        status: 'cancelled',
        latestVersion: 0,
      }),
    );
    expect(
      observed.mock.calls.some(([value]) => value.status === 'failed'),
    ).toBe(false);
  });
});
