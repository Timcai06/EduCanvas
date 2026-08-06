import type {
  TurnUsageBudgetLedgerEntry,
  TurnUsageBudgetLedgerPort,
} from '@educanvas/agent-core';
import { getDb } from './client';
import { turnUsageBudgetOutcomes } from './schema';

type Database = ReturnType<typeof getDb>;

/**
 * Turn 使用预算账本（Q03）— append-only，每次 Turn 一行。
 *
 * 账本行只含预算维度数值与低基数 breachReason；正文/Prompt/供应商响应
 * 永不落库（见 turn_usage_budget_outcomes 表定义与 CHECK 约束）。
 */
export class DrizzleTurnUsageBudgetLedger implements TurnUsageBudgetLedgerPort {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async record(entry: TurnUsageBudgetLedgerEntry): Promise<void> {
    await this.database.insert(turnUsageBudgetOutcomes).values({
      operationId: entry.operationId,
      profileId: entry.profileId,
      breachReason: entry.breachReason,
      estimated: entry.estimated,
      estimatedCostCents: entry.estimatedCostCents,
      modelCalls: entry.modelCalls,
      toolCalls: entry.toolCalls,
      toolResultsTruncated: entry.toolResultsTruncated,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      wallClockMs: entry.wallClockMs,
    });
  }
}
