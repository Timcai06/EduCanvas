import 'server-only';

import type { ModelAbortSignal } from '@educanvas/agent-core';
import type { TurnApplicationCancellationPort } from '@educanvas/agent-runtime';
import { DEFAULT_ASSISTANT_LEASE_MS } from '@educanvas/db';
import { webTeachingPersistence } from './persistence';

const HEARTBEAT_INTERVAL_MS = 10_000;
const CANCELLATION_POLL_MS = 250;

/** 合并上游 Abort、lease heartbeat 与数据库取消事实，并在 close 时释放计时器。 */
export class WebTeachingCancellation implements TurnApplicationCancellationPort {
  constructor(private readonly upstream: ModelAbortSignal) {}

  async open(input: { operationId: string; actorId: string }) {
    const snapshot = await webTeachingPersistence.chat.getOwnedTurnByTurnId({
      trustedStudentId: input.actorId,
      turnId: input.operationId,
    });
    const leaseId = snapshot?.assistantMessage.leaseId;
    if (!snapshot || !leaseId) throw new Error('teaching_turn_lease_missing');
    const controller = new AbortController();
    let heartbeatRunning = false;
    let cancellationRunning = false;
    const abort = () => {
      if (!controller.signal.aborted) controller.abort('turn_cancelled');
    };
    if (this.upstream.aborted) abort();
    else this.upstream.addEventListener('abort', abort, { once: true });
    const heartbeat = setInterval(() => {
      if (heartbeatRunning || controller.signal.aborted) return;
      heartbeatRunning = true;
      void webTeachingPersistence.leases
        .heartbeat({
          trustedStudentId: input.actorId,
          turnId: input.operationId,
          leaseId,
          leaseDurationMs: DEFAULT_ASSISTANT_LEASE_MS,
        })
        .then((renewed) => {
          if (!renewed) abort();
        })
        .catch(() => undefined)
        .finally(() => {
          heartbeatRunning = false;
        });
    }, HEARTBEAT_INTERVAL_MS);
    const cancellation = setInterval(() => {
      if (cancellationRunning || controller.signal.aborted) return;
      cancellationRunning = true;
      void webTeachingPersistence.chat
        .isTurnCancellationRequested({
          trustedStudentId: input.actorId,
          turnId: input.operationId,
        })
        .then((requested) => {
          if (requested) abort();
        })
        .catch(() => undefined)
        .finally(() => {
          cancellationRunning = false;
        });
    }, CANCELLATION_POLL_MS);
    return {
      signal: controller.signal,
      isCancellationRequested: async () =>
        (await webTeachingPersistence.chat.isTurnCancellationRequested({
          trustedStudentId: input.actorId,
          turnId: input.operationId,
        })) || this.upstream.aborted,
      close: () => {
        clearInterval(heartbeat);
        clearInterval(cancellation);
        this.upstream.removeEventListener('abort', abort);
      },
    };
  }
}
