import { getDb } from './client';
import { securityAuditEvents } from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type DatabaseExecutor = Database | DatabaseTransaction;

export type SecurityAuditOutcome = 'succeeded' | 'denied' | 'failed';

export interface SecurityAuditEventInput {
  actorUserId?: string | null;
  eventType: string;
  resourceType?: string | null;
  resourceId?: string | null;
  outcome: SecurityAuditOutcome;
  reasonCode?: string | null;
  requestId?: string | null;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
  occurredAt?: Date;
}

const FORBIDDEN_METADATA_KEY =
  /(password|passwd|secret|token|cookie|prompt|provider|response|stack|objectkey|storagekey)/i;

function validateMetadata(
  value: SecurityAuditEventInput['metadata'],
): Record<string, string | number | boolean | null> {
  const metadata = { ...(value ?? {}) };
  for (const [key, entry] of Object.entries(metadata)) {
    if (
      !/^[a-z][a-z0-9_]{0,63}$/i.test(key) ||
      FORBIDDEN_METADATA_KEY.test(key) ||
      (typeof entry === 'string' && entry.length > 300)
    ) {
      throw new Error('security_audit_metadata_invalid');
    }
  }
  return metadata;
}

/** 只追加安全审计事件；调用方应与被审计写操作共用事务。 */
export async function appendSecurityAuditEvent(
  executor: DatabaseExecutor,
  input: SecurityAuditEventInput,
): Promise<string> {
  const [event] = await executor
    .insert(securityAuditEvents)
    .values({
      actorUserId: input.actorUserId ?? null,
      eventType: input.eventType,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      outcome: input.outcome,
      reasonCode: input.reasonCode ?? null,
      requestId: input.requestId ?? null,
      metadata: validateMetadata(input.metadata),
      occurredAt: input.occurredAt ?? new Date(),
    })
    .returning({ id: securityAuditEvents.id });
  if (!event) throw new Error('security_audit_write_failed');
  return event.id;
}

export class DrizzleSecurityAuditRepository {
  constructor(private readonly providedDatabase?: Database) {}

  append(input: SecurityAuditEventInput): Promise<string> {
    return appendSecurityAuditEvent(this.providedDatabase ?? getDb(), input);
  }
}
