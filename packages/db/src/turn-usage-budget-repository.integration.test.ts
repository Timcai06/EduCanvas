import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TurnUsageBudgetLedgerEntry } from '@educanvas/agent-core';
import { DrizzleTurnUsageBudgetLedger } from './turn-usage-budget-repository';
import * as schema from './schema';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error('集成测试拒绝清空非测试数据库');
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 6 })
  : null;
const database = connection ? drizzle(connection, { schema }) : null;

function getDatabase() {
  if (!database) throw new Error('TEST_DATABASE_URL未设置');
  return database;
}

describeWithDatabase('Turn 使用预算账本（Q03）', () => {
  beforeAll(async () => {
    await migrate(getDatabase(), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  afterAll(async () => {
    await connection?.end();
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`truncate table turn_usage_budget_outcomes`);
  });

  const ledger = () => new DrizzleTurnUsageBudgetLedger(getDatabase());

  const entry = (
    overrides: Partial<TurnUsageBudgetLedgerEntry> = {},
  ): TurnUsageBudgetLedgerEntry => ({
    operationId: randomUUID(),
    profileId: 'teaching.turn',
    breachReason: null,
    estimated: false,
    estimatedCostCents: 2,
    modelCalls: 3,
    toolCalls: 1,
    toolResultsTruncated: 0,
    inputTokens: 1_234,
    outputTokens: 456,
    wallClockMs: 5_000,
    ...overrides,
  });

  it('预算内正常完成的 Turn 记录一行且 breachReason 为空', async () => {
    const input = entry();
    await ledger().record(input);
    const rows = await getDatabase()
      .select()
      .from(schema.turnUsageBudgetOutcomes)
      .where(eq(schema.turnUsageBudgetOutcomes.operationId, input.operationId));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.profileId).toBe('teaching.turn');
    expect(row.breachReason).toBeNull();
    expect(row.estimated).toBe(false);
    expect(row.estimatedCostCents).toBe(2);
    expect(row.modelCalls).toBe(3);
    expect(row.toolCalls).toBe(1);
    expect(row.toolResultsTruncated).toBe(0);
    expect(row.inputTokens).toBe(1_234);
    expect(row.outputTokens).toBe(456);
    expect(row.wallClockMs).toBe(5_000);
  });

  it('超预算终态的 Turn 记录 breachReason 与估算标记', async () => {
    await ledger().record(
      entry({
        breachReason: 'max_estimated_cost',
        estimated: true,
        estimatedCostCents: 250,
      }),
    );
    const rows = await getDatabase()
      .select()
      .from(schema.turnUsageBudgetOutcomes);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.breachReason).toBe('max_estimated_cost');
    expect(rows[0]?.estimated).toBe(true);
    expect(rows[0]?.estimatedCostCents).toBe(250);
  });

  it('重复 operationId 冲突（每个 Turn 只落一行）', async () => {
    const input = entry();
    await ledger().record(input);
    await expect(ledger().record(input)).rejects.toThrow();
    const rows = await getDatabase()
      .select()
      .from(schema.turnUsageBudgetOutcomes)
      .where(eq(schema.turnUsageBudgetOutcomes.operationId, input.operationId));
    expect(rows).toHaveLength(1);
  });

  it('非法 breachReason 被数据库 CHECK 约束拒绝', async () => {
    await expect(
      ledger().record(entry({ breachReason: 'user_typed_text' as never })),
    ).rejects.toThrow();
  });

  it('工具结果截断与调用数原样落账', async () => {
    await ledger().record(
      entry({ toolCalls: 4, toolResultsTruncated: 2, modelCalls: 7 }),
    );
    const rows = await getDatabase()
      .select()
      .from(schema.turnUsageBudgetOutcomes);
    expect(rows[0]?.toolCalls).toBe(4);
    expect(rows[0]?.toolResultsTruncated).toBe(2);
    expect(rows[0]?.modelCalls).toBe(7);
  });
});
