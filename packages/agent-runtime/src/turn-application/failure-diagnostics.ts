interface FailureDiagnosticInput {
  operationId: string;
  stage: string;
  error: unknown;
  now?: Date;
}

const stableIdentifier = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
    ? value
    : fallback;

/** 只投影低敏感错误形状；被拒绝的值、正文、Prompt 与堆栈永不进入日志。 */
export function turnApplicationFailureLogLine(
  input: FailureDiagnosticInput,
): string {
  const error = input.error;
  const rawCode =
    error instanceof Error
      ? ((error as Error & { code?: unknown }).code ?? error.message)
      : undefined;
  const issues =
    typeof error === 'object' &&
    error !== null &&
    Array.isArray((error as { issues?: unknown }).issues)
      ? (error as { issues: unknown[] }).issues.slice(0, 8).map((issue) => {
          const candidate = issue as {
            code?: unknown;
            path?: unknown;
            keys?: unknown;
          };
          return {
            code: stableIdentifier(candidate.code, 'unknown'),
            path: Array.isArray(candidate.path)
              ? candidate.path
                  .slice(0, 8)
                  .filter(
                    (segment): segment is string | number =>
                      typeof segment === 'string' ||
                      typeof segment === 'number',
                  )
              : [],
            keys: Array.isArray(candidate.keys)
              ? candidate.keys
                  .slice(0, 8)
                  .filter(
                    (key): key is string => stableIdentifier(key, '') !== '',
                  )
              : [],
          };
        })
      : undefined;
  return JSON.stringify({
    schema: 'educanvas.log.v1',
    ts: (input.now ?? new Date()).toISOString(),
    level: 'error',
    service: 'agent-runtime',
    event: 'turn.application.failed',
    message: 'Turn application failed before a classified terminal outcome',
    operationId: input.operationId,
    stage: input.stage,
    error: {
      name: error instanceof Error ? error.name : 'UnknownError',
      code: stableIdentifier(rawCode, 'unclassified'),
      ...(issues ? { issues } : {}),
    },
  });
}
