import { tryParseLogRecord } from '../local/local-process-pipe.mjs';

const FAILED_TASK_PATTERN =
  /ERROR:\s+Failed task\s+\d+\s+\(([^,\s]+),[\s\S]*?attempt\s+(\d+)\s+of\s+(\d+)\)/;

function normalizeTaskIdentifier(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value)
    ? value
    : 'unknown';
}

/**
 * Collects Graphile Worker task failures without retaining payloads, object keys,
 * provider responses, or stack traces. E2E may allow a specific task identifier
 * only when the scenario intentionally proves its failure semantics.
 */
export function createE2eWorkerLogAudit({ allowedTaskIdentifiers = [] } = {}) {
  const allowed = new Set(allowedTaskIdentifiers);
  const failures = new Map();
  let pending = '';

  function inspectLine(line) {
    const record = tryParseLogRecord(line);
    const match = FAILED_TASK_PATTERN.exec(line);
    const structuredFailure =
      record?.service === 'worker' && record.event === 'worker.job.failed';
    if (!structuredFailure && !match) return;
    const taskIdentifier = normalizeTaskIdentifier(
      structuredFailure ? record.taskIdentifier : match?.[1],
    );
    if (taskIdentifier !== 'unknown' && allowed.has(taskIdentifier)) return;
    const rawAttempt = structuredFailure ? record.attempt : Number(match[2]);
    const rawMaxAttempts = structuredFailure
      ? record.maxAttempts
      : Number(match[3]);
    const attempt =
      Number.isSafeInteger(rawAttempt) && rawAttempt > 0
        ? rawAttempt
        : 'unknown';
    const maxAttempts =
      Number.isSafeInteger(rawMaxAttempts) && rawMaxAttempts > 0
        ? rawMaxAttempts
        : 'unknown';
    failures.set(
      `${taskIdentifier}:${attempt}:${maxAttempts}`,
      Object.freeze({
        taskIdentifier,
        attempt,
        maxAttempts,
      }),
    );
  }

  return Object.freeze({
    ingest(chunk) {
      pending += String(chunk);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) inspectLine(line);
    },
    assertClean() {
      if (pending) {
        inspectLine(pending);
        pending = '';
      }
      if (failures.size === 0) return;
      const summary = [...failures.values()]
        .map(
          ({ taskIdentifier, attempt, maxAttempts }) =>
            `${taskIdentifier} attempt ${attempt}/${maxAttempts}`,
        )
        .join(', ');
      throw new Error(`E2E Worker 出现未允许的后台任务失败: ${summary}`);
    },
  });
}
