export interface E2eWorkerLogAudit {
  ingest(chunk: string | Buffer): void;
  assertClean(): void;
}

export function createE2eWorkerLogAudit(options?: {
  allowedTaskIdentifiers?: readonly string[];
}): E2eWorkerLogAudit;
