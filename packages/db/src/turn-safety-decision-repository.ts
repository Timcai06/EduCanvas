import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from './client';
import { chatMessages, lessonSessions, turnSafetyDecisions } from './schema';

type Database = ReturnType<typeof getDb>;
type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export const TURN_SAFETY_PHASES = ['input', 'output'] as const;
export const TURN_SAFETY_CATEGORIES = [
  'normal',
  'pii',
  'prompt_injection',
  'self_harm',
  'abuse',
  'sexual_content',
  'violence',
  'dangerous_behavior',
] as const;
export const TURN_SAFETY_ACTIONS = ['allow', 'block', 'escalate'] as const;

export type TurnSafetyPhase = (typeof TURN_SAFETY_PHASES)[number];
export type TurnSafetyCategory = (typeof TURN_SAFETY_CATEGORIES)[number];
export type TurnSafetyAction = (typeof TURN_SAFETY_ACTIONS)[number];

export interface RecordTurnSafetyDecisionInput {
  trustedStudentId: string;
  sessionId: string;
  turnId: string;
  phase: TurnSafetyPhase;
  policyVersion: string;
  category: TurnSafetyCategory;
  action: TurnSafetyAction;
  detectorVersion: string;
  /** 仅用于确定性测试；生产调用应让数据库生成时间。 */
  now?: Date;
}

export interface TurnSafetyDecisionSnapshot {
  sessionId: string;
  turnId: string;
  phase: TurnSafetyPhase;
  policyVersion: string;
  category: TurnSafetyCategory;
  action: TurnSafetyAction;
  detectorVersion: string;
  createdAt: string;
}

export interface RecordedTurnSafetyDecision {
  replayed: boolean;
  decision: TurnSafetyDecisionSnapshot;
}

/** 不区分“session不存在”和“归属不匹配”，避免借审计接口枚举他人Turn。 */
export class SafetyDecisionOwnershipError extends Error {
  readonly code = 'safety_turn_not_found';

  constructor() {
    super('安全决策对应的Turn不存在或不属于当前学生');
    this.name = 'SafetyDecisionOwnershipError';
  }
}

/** 同一幂等决策键出现不同结果，或normal与风险类别混写时拒绝静默覆盖。 */
export class SafetyDecisionConflictError extends Error {
  readonly code = 'safety_decision_conflict';

  constructor() {
    super('安全决策重放内容冲突');
    this.name = 'SafetyDecisionConflictError';
  }
}

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function requireMember<const Value extends string>(
  value: string,
  allowed: readonly Value[],
  field: string,
): Value {
  if (!allowed.includes(value as Value)) {
    throw new TypeError(`${field}不是受支持的稳定值`);
  }
  return value as Value;
}

function requireVersion(value: string, field: string): string {
  if (!VERSION_PATTERN.test(value)) {
    throw new TypeError(`${field}必须为1-128位安全版本标识`);
  }
  return value;
}

function validateInput(input: RecordTurnSafetyDecisionInput) {
  const phase = requireMember(input.phase, TURN_SAFETY_PHASES, 'phase');
  const category = requireMember(
    input.category,
    TURN_SAFETY_CATEGORIES,
    'category',
  );
  const action = requireMember(input.action, TURN_SAFETY_ACTIONS, 'action');
  return {
    ...input,
    phase,
    category,
    action,
    policyVersion: requireVersion(input.policyVersion, 'policyVersion'),
    detectorVersion: requireVersion(input.detectorVersion, 'detectorVersion'),
  };
}

function toSnapshot(
  row: typeof turnSafetyDecisions.$inferSelect,
): TurnSafetyDecisionSnapshot {
  return {
    sessionId: row.sessionId,
    turnId: row.turnId,
    phase: requireMember(row.phase, TURN_SAFETY_PHASES, 'phase'),
    policyVersion: row.policyVersion,
    category: requireMember(row.category, TURN_SAFETY_CATEGORIES, 'category'),
    action: requireMember(row.action, TURN_SAFETY_ACTIONS, 'action'),
    detectorVersion: row.detectorVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

function decisionLockKey(input: {
  turnId: string;
  phase: TurnSafetyPhase;
  policyVersion: string;
}): string {
  return [
    'turn-safety-decision-v1',
    input.turnId,
    input.phase,
    input.policyVersion,
  ].join(':');
}

async function assertOwnedTurn(
  transaction: DatabaseTransaction,
  input: {
    trustedStudentId: string;
    sessionId: string;
    turnId: string;
  },
): Promise<void> {
  const [owned] = await transaction
    .select({ sessionId: lessonSessions.id })
    .from(lessonSessions)
    .innerJoin(
      chatMessages,
      and(
        eq(chatMessages.sessionId, lessonSessions.id),
        eq(chatMessages.turnId, input.turnId),
      ),
    )
    .where(
      and(
        eq(lessonSessions.id, input.sessionId),
        eq(lessonSessions.studentId, input.trustedStudentId),
      ),
    )
    .limit(1);
  if (!owned) throw new SafetyDecisionOwnershipError();
}

/**
 * 仅持久化脱敏后的安全分类。相同决策键重放返回原记录；不同动作或detector版本视为冲突，
 * 防止审计事实被重试静默改写。同一检测批次内normal不能与风险类别并存。
 */
export class DrizzleTurnSafetyDecisionRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async record(
    rawInput: RecordTurnSafetyDecisionInput,
  ): Promise<RecordedTurnSafetyDecision> {
    const input = validateInput(rawInput);
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${decisionLockKey(input)}, 0))`,
      );
      await assertOwnedTurn(transaction, input);

      const siblingRows = await transaction
        .select({ category: turnSafetyDecisions.category })
        .from(turnSafetyDecisions)
        .where(
          and(
            eq(turnSafetyDecisions.turnId, input.turnId),
            eq(turnSafetyDecisions.phase, input.phase),
            eq(turnSafetyDecisions.policyVersion, input.policyVersion),
          ),
        );
      const hasNormal = siblingRows.some(
        (decision) => decision.category === 'normal',
      );
      const hasRisk = siblingRows.some(
        (decision) => decision.category !== 'normal',
      );
      if (
        (input.category === 'normal' && hasRisk) ||
        (input.category !== 'normal' && hasNormal)
      ) {
        throw new SafetyDecisionConflictError();
      }

      const [created] = await transaction
        .insert(turnSafetyDecisions)
        .values({
          sessionId: input.sessionId,
          turnId: input.turnId,
          phase: input.phase,
          policyVersion: input.policyVersion,
          category: input.category,
          action: input.action,
          detectorVersion: input.detectorVersion,
          createdAt: input.now,
        })
        .onConflictDoNothing()
        .returning();
      if (created) return { replayed: false, decision: toSnapshot(created) };

      const [existing] = await transaction
        .select()
        .from(turnSafetyDecisions)
        .where(
          and(
            eq(turnSafetyDecisions.turnId, input.turnId),
            eq(turnSafetyDecisions.phase, input.phase),
            eq(turnSafetyDecisions.policyVersion, input.policyVersion),
            eq(turnSafetyDecisions.category, input.category),
          ),
        )
        .limit(1);
      if (
        !existing ||
        existing.sessionId !== input.sessionId ||
        existing.action !== input.action ||
        existing.detectorVersion !== input.detectorVersion
      ) {
        throw new SafetyDecisionConflictError();
      }
      return { replayed: true, decision: toSnapshot(existing) };
    });
  }

  async listOwnedByTurn(input: {
    trustedStudentId: string;
    sessionId: string;
    turnId: string;
  }): Promise<readonly TurnSafetyDecisionSnapshot[]> {
    return this.database.transaction(async (transaction) => {
      await assertOwnedTurn(transaction, input);
      const rows = await transaction
        .select()
        .from(turnSafetyDecisions)
        .where(
          and(
            eq(turnSafetyDecisions.sessionId, input.sessionId),
            eq(turnSafetyDecisions.turnId, input.turnId),
          ),
        )
        .orderBy(
          asc(turnSafetyDecisions.createdAt),
          asc(turnSafetyDecisions.phase),
          asc(turnSafetyDecisions.category),
        );
      return rows.map(toSnapshot);
    });
  }
}
