import type { ArtifactDetail } from '@/features/canvas/artifact-client';
import type { ChatMessage, MessageArtifactDTO } from '@/features/chat/messages';
import { projectConversationArtifactDetail } from './conversation-artifact-observation';

export function conversationArtifactReferences(
  messages: readonly ChatMessage[],
): readonly MessageArtifactDTO[] {
  return [
    ...new Map(
      messages.flatMap((message) =>
        message.role === 'assistant'
          ? (message.artifacts ?? []).map(
              (artifact) => [artifact.id, artifact] as const,
            )
          : [],
      ),
    ).values(),
  ];
}

interface Observation {
  artifact: MessageArtifactDTO;
  startedAt: number;
  dueAt: number;
  attempts: number;
  settled: boolean;
  controller?: AbortController;
}

/** One bounded, fair request queue for every visible conversation reference. */
export function createConversationArtifactObserver(input: {
  fetchDetail: (id: string, signal: AbortSignal) => Promise<ArtifactDetail>;
  onObserved: (artifact: MessageArtifactDTO) => void;
}) {
  const observations = new Map<string, Observation>();
  let disposed = false;
  let active = 0;
  let nextStartAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const current = (entry: Observation) =>
    !disposed && observations.get(entry.artifact.id) === entry;

  function schedule() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (disposed || active >= 2) return;
    const pending = [...observations.values()].filter(
      (entry) => !entry.settled && !entry.controller,
    );
    if (!pending.length) return;
    const dueAt = Math.min(...pending.map((entry) => entry.dueAt));
    timer = setTimeout(
      pump,
      Math.max(0, Math.max(dueAt, nextStartAt) - Date.now()),
    );
  }

  function pump() {
    timer = undefined;
    const now = Date.now();
    const entry = [...observations.values()]
      .filter((candidate) => !candidate.settled && !candidate.controller)
      .sort((left, right) => left.dueAt - right.dueAt)[0];
    if (!entry || disposed || active >= 2) return;
    if (entry.attempts >= 40 || now - entry.startedAt >= 5 * 60_000) {
      entry.settled = true;
      input.onObserved({ ...entry.artifact, observationTimedOut: true });
      schedule();
      return;
    }
    const controller = new AbortController();
    entry.controller = controller;
    entry.attempts += 1;
    active += 1;
    nextStartAt = now + 750;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timeout);
      active -= 1;
      if (current(entry)) {
        entry.controller = undefined;
        entry.dueAt =
          Date.now() + Math.min(8_000, 1_500 * 1.5 ** (entry.attempts - 1));
      }
      schedule();
    };
    controller.signal.addEventListener('abort', release, { once: true });
    void input
      .fetchDetail(entry.artifact.id, controller.signal)
      .then((detail) => {
        if (
          !current(entry) ||
          controller.signal.aborted ||
          detail.artifact.id !== entry.artifact.id
        )
          return;
        const observed = projectConversationArtifactDetail(detail);
        if (observed) {
          entry.settled = true;
          input.onObserved(observed);
        } else if (
          detail.latestJob?.status === 'queued' ||
          detail.latestJob?.status === 'running'
        ) {
          if (
            entry.artifact.status !== 'proposed' ||
            entry.artifact.observationTimedOut
          ) {
            input.onObserved({
              ...entry.artifact,
              status: 'proposed',
              observationTimedOut: false,
            });
          }
        }
      })
      .catch(() => {
        // Transport failure/local abort says nothing about the durable job.
      })
      .finally(release);
    schedule();
  }

  return {
    sync(artifacts: readonly MessageArtifactDTO[], resume = false) {
      if (disposed) return;
      const ids = new Set(artifacts.map((artifact) => artifact.id));
      for (const [id, entry] of observations) {
        if (!ids.has(id)) {
          observations.delete(id);
          entry.controller?.abort();
        }
      }
      for (const artifact of artifacts) {
        const entry = observations.get(artifact.id);
        if (entry) {
          const restarted =
            artifact.status === 'proposed' &&
            entry.artifact.status !== 'proposed';
          if (restarted || (resume && !entry.controller)) {
            // Replace identity before abort: even an uncancellable late read
            // belongs to the old generation and cannot settle the new retry.
            observations.set(artifact.id, {
              artifact,
              startedAt: Date.now(),
              dueAt: Date.now(),
              attempts: 0,
              settled: false,
            });
            entry.controller?.abort();
            if (artifact.observationTimedOut)
              input.onObserved({ ...artifact, observationTimedOut: false });
          } else entry.artifact = artifact;
          continue;
        }
        if (artifact.status !== 'proposed' && !resume) continue;
        observations.set(artifact.id, {
          artifact,
          startedAt: Date.now(),
          dueAt: Date.now(),
          attempts: 0,
          settled: false,
        });
      }
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const entry of observations.values()) entry.controller?.abort();
      observations.clear();
    },
  };
}
