export const workerCrontab =
  '15 3 * * * maintenance:purge_anonymous_subjects ?id=anonymous-retention-daily&fill=1d&max=1 {limit:100}';
