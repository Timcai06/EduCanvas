export const workerCrontab = [
  '* * * * * maintenance:recover_operation_continuations ?id=operation-continuation-recovery&fill=10m&max=1 {limit:100}',
  '*/5 * * * * maintenance:reconcile_tool_approval_intents ?id=tool-approval-intent-reconciliation&fill=10m&max=1 {limit:500}',
  '15 3 * * * maintenance:purge_anonymous_subjects ?id=anonymous-retention-daily&fill=1d&max=1 {limit:100}',
].join('\n');
