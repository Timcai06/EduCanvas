import { fetchArtifactDetail, type ArtifactDetail } from './artifact-client';

export type PollOutcome =
  'ready' | 'failed' | 'cancelled' | 'timed_out' | 'pending';

export interface PollArtifactResult {
  detail: ArtifactDetail;
  outcome: PollOutcome;
}

function classifyPollOutcome(
  detail: ArtifactDetail,
  minimumVersion: number,
): PollOutcome {
  const jobStatus = detail.latestJob?.status;
  if (jobStatus === 'failed') return 'failed';
  if (jobStatus === 'cancelled') return 'cancelled';
  if (
    detail.artifact.latestVersion >= minimumVersion &&
    (jobStatus === undefined || jobStatus === 'succeeded')
  )
    return 'ready';
  return 'pending';
}

async function sleepWithSignal(
  intervalMs: number,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, intervalMs);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** One bounded poll window; local abort remains distinct from server cancellation. */
export async function pollArtifactUntilSettled(
  artifactId: string,
  options: {
    intervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    minimumVersion?: number;
  } = {},
): Promise<PollArtifactResult> {
  const interval = options.intervalMs ?? 1_500;
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  let detail = await fetchArtifactDetail(artifactId, undefined, {
    signal: options.signal,
  });
  while (Date.now() < deadline && !options.signal?.aborted) {
    const outcome = classifyPollOutcome(detail, options.minimumVersion ?? 1);
    if (outcome !== 'pending') return { detail, outcome };
    await sleepWithSignal(interval, options.signal);
    detail = await fetchArtifactDetail(artifactId, undefined, {
      signal: options.signal,
    });
  }
  if (options.signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  const outcome = classifyPollOutcome(detail, options.minimumVersion ?? 1);
  return { detail, outcome: outcome === 'pending' ? 'timed_out' : outcome };
}
