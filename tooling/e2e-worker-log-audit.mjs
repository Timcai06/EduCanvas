const FAILED_TASK_PATTERN =
  /ERROR:\s+Failed task\s+\d+\s+\(([^,\s]+),[\s\S]*?attempt\s+(\d+)\s+of\s+(\d+)\)/;

function normalizeTaskIdentifier(value) {
  return value.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 120);
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
    const match = FAILED_TASK_PATTERN.exec(line);
    if (!match) return;
    const taskIdentifier = normalizeTaskIdentifier(match[1] ?? '');
    if (!taskIdentifier || allowed.has(taskIdentifier)) return;
    const attempt = Number(match[2]);
    const maxAttempts = Number(match[3]);
    failures.set(
      `${taskIdentifier}:${attempt}:${maxAttempts}`,
      Object.freeze({ taskIdentifier, attempt, maxAttempts }),
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
