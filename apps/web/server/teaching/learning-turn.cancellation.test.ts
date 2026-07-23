import type { ModelAbortSignal } from '@educanvas/agent-core';
import type { ChatMessageSnapshot, TeachingTurnSnapshot } from '@educanvas/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebTeachingCancellation } from './turn-application/cancellation';
import { webTeachingPersistence } from './turn-application/persistence';

vi.mock('server-only', () => ({}));

class TestAbortSignal implements ModelAbortSignal {
  aborted = false;
  private readonly listeners = new Set<() => void>();

  get listenerCount(): number {
    return this.listeners.size;
  }

  addEventListener(_type: 'abort', listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'abort', listener: () => void): void {
    this.listeners.delete(listener);
  }

  abort(): void {
    this.aborted = true;
    for (const listener of this.listeners) listener();
  }
}

function message(role: ChatMessageSnapshot['role']): ChatMessageSnapshot {
  const assistant = role === 'assistant';
  return {
    id: assistant ? 'assistant-message-1' : 'user-message-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    clientMessageId: assistant ? null : 'client-message-1',
    role,
    status: assistant ? 'pending' : 'completed',
    content: assistant ? '' : '学生问题',
    parts: assistant ? [] : [{ type: 'text', text: '学生问题' }],
    failureCode: null,
    createdAt: '2026-07-23T00:00:00.000Z',
    completedAt: assistant ? null : '2026-07-23T00:00:01.000Z',
    cancelRequestedAt: null,
    cancelledAt: null,
    leaseId: assistant ? 'lease-1' : null,
    leaseExpiresAt: assistant ? '2026-07-23T00:01:00.000Z' : null,
    heartbeatAt: assistant ? '2026-07-23T00:00:00.000Z' : null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('WebTeachingCancellation characterization', () => {
  it('open 维持 heartbeat 与取消轮询，upstream abort 后 close 清理全部资源', async () => {
    const snapshot: TeachingTurnSnapshot = {
      turnId: 'turn-1',
      studentMessage: message('student'),
      assistantMessage: message('assistant'),
    };
    vi.spyOn(
      webTeachingPersistence.chat,
      'getOwnedTurnByTurnId',
    ).mockResolvedValue(snapshot);
    vi.spyOn(
      webTeachingPersistence.chat,
      'isTurnCancellationRequested',
    ).mockResolvedValue(false);
    const heartbeat = vi
      .spyOn(webTeachingPersistence.leases, 'heartbeat')
      .mockResolvedValue(true);
    const upstream = new TestAbortSignal();
    const cancellation = new WebTeachingCancellation(upstream);

    const handle = await cancellation.open({
      operationId: 'turn-1',
      actorId: 'student-1',
    });
    expect(upstream.listenerCount).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(heartbeat).toHaveBeenCalledWith({
      trustedStudentId: 'student-1',
      turnId: 'turn-1',
      leaseId: 'lease-1',
      leaseDurationMs: 45_000,
    });

    upstream.abort();
    expect(handle.signal?.aborted).toBe(true);
    await handle.close();
    expect(upstream.listenerCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
