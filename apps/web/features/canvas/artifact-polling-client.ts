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
    /** 每次拉取到 detail 后回报服务端 job 进度（0-100）。 */
    onProgress?: (progress: number) => void;
  } = {},
): Promise<PollArtifactResult> {
  const interval = options.intervalMs ?? 1_500;
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  const reportProgress = (detail: ArtifactDetail) => {
    const progress = detail.latestJob?.progress;
    if (progress !== null && progress !== undefined) {
      options.onProgress?.(progress);
    }
  };
  let detail = await fetchArtifactDetail(artifactId, undefined, {
    signal: options.signal,
  });
  reportProgress(detail);
  while (Date.now() < deadline && !options.signal?.aborted) {
    const outcome = classifyPollOutcome(detail, options.minimumVersion ?? 1);
    if (outcome !== 'pending') return { detail, outcome };
    await sleepWithSignal(interval, options.signal);
    detail = await fetchArtifactDetail(artifactId, undefined, {
      signal: options.signal,
    });
    reportProgress(detail);
  }
  if (options.signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  const outcome = classifyPollOutcome(detail, options.minimumVersion ?? 1);
  return { detail, outcome: outcome === 'pending' ? 'timed_out' : outcome };
}

export interface PollArtifactToTerminalOptions {
  signal?: AbortSignal;
  minimumVersion?: number;
  /** Upper bound across every poll window, including retry/backoff time. */
  totalTimeoutMs?: number;
  /** Compatibility alias for callers that think in terms of one total timeout. */
  timeoutMs?: number;
  windowTimeoutMs?: number;
  initialIntervalMs?: number;
  maxIntervalMs?: number;
  backoffFactor?: number;
  /** A second independent stop condition protects mocked/clockless environments. */
  maxPollWindows?: number;
  maxAttempts?: number;
  /** 每次轮询窗口拉取到服务端 job 进度时回调（0-100）。 */
  onProgress?: (progress: number) => void;
}

const DEFAULT_POLL_TOTAL_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_WINDOW_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;
const DEFAULT_POLL_MAX_INTERVAL_MS = 8_000;
const DEFAULT_POLL_BACKOFF_FACTOR = 1.5;
const DEFAULT_POLL_MAX_WINDOWS = 5;

/** Long-running durable jobs use bounded windows with backoff and an explicit stop. */
export async function pollArtifactToTerminal(
  artifactId: string,
  options: PollArtifactToTerminalOptions = {},
): Promise<PollArtifactResult> {
  const totalTimeoutMs = Math.max(
    0,
    options.totalTimeoutMs ??
      options.timeoutMs ??
      DEFAULT_POLL_TOTAL_TIMEOUT_MS,
  );
  const windowTimeoutMs = Math.max(
    0,
    options.windowTimeoutMs ?? DEFAULT_POLL_WINDOW_TIMEOUT_MS,
  );
  const maxPollWindows = Math.max(
    1,
    Math.floor(
      options.maxPollWindows ?? options.maxAttempts ?? DEFAULT_POLL_MAX_WINDOWS,
    ),
  );
  const maxIntervalMs = Math.max(
    0,
    options.maxIntervalMs ?? DEFAULT_POLL_MAX_INTERVAL_MS,
  );
  const backoffFactor = Math.max(
    1,
    options.backoffFactor ?? DEFAULT_POLL_BACKOFF_FACTOR,
  );
  let intervalMs = Math.max(
    0,
    options.initialIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  );
  const deadline = Date.now() + totalTimeoutMs;

  for (let attempt = 0; attempt < maxPollWindows; attempt += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    const remainingMs = Math.max(0, deadline - Date.now());
    const result = await pollArtifactUntilSettled(artifactId, {
      signal: options.signal,
      minimumVersion: options.minimumVersion,
      intervalMs,
      timeoutMs: Math.min(windowTimeoutMs, remainingMs),
      onProgress: options.onProgress,
    });
    if (result.outcome !== 'timed_out') return result;
    if (attempt + 1 >= maxPollWindows || Date.now() >= deadline) return result;
    intervalMs = Math.min(
      maxIntervalMs,
      Math.max(intervalMs, intervalMs * backoffFactor),
    );
  }

  throw new Error('artifact_poll_window_invariant');
}
