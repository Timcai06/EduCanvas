import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { DrizzlePlatformConversationRepository } from './conversation-platform-repository';
import * as schema from './schema';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error('迁移测试拒绝使用非隔离数据库');
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

interface MigrationJournal {
  version: string;
  dialect: string;
  entries: {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }[];
}

function withDatabaseName(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

/** 使用真实Drizzle journal构造截止指定序号的迁移包，避免测试手工回放SQL。 */
async function withMigrationBundleThrough(
  lastMigrationIndex: number,
  operation: (folder: string) => Promise<void>,
): Promise<void> {
  const folder = await mkdtemp(
    join(tmpdir(), `educanvas-model-run-${lastMigrationIndex}-`),
  );
  const journal = JSON.parse(
    await readFile(`${migrationsFolder}/meta/_journal.json`, 'utf8'),
  ) as MigrationJournal;
  const entries = journal.entries.filter(
    (entry) => entry.idx <= lastMigrationIndex,
  );
  try {
    await mkdir(`${folder}/meta`);
    await writeFile(
      `${folder}/meta/_journal.json`,
      JSON.stringify({ ...journal, entries }),
    );
    for (const entry of entries) {
      await copyFile(
        `${migrationsFolder}/${entry.tag}.sql`,
        `${folder}/${entry.tag}.sql`,
      );
    }
    await operation(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function withTemporaryDatabase(
  operation: (connection: ReturnType<typeof postgres>) => Promise<void>,
): Promise<void> {
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL未设置');
  const databaseName = `educanvas_model_run_${randomUUID().replaceAll('-', '')}_test`;
  const admin = postgres(withDatabaseName(testDatabaseUrl, 'postgres'), {
    max: 1,
  });
  await admin.unsafe(`create database "${databaseName}"`);
  const connection = postgres(withDatabaseName(testDatabaseUrl, databaseName), {
    max: 1,
  });
  try {
    await operation(connection);
  } finally {
    await connection.end({ timeout: 5 });
    await admin.unsafe(
      `drop database if exists "${databaseName}" with (force)`,
    );
    await admin.end({ timeout: 5 });
  }
}

async function createAgentTurnFixture(
  connection: ReturnType<typeof postgres>,
): Promise<{ operationId: string; assistantMessageId: string }> {
  const database = drizzle(connection, { schema });
  const actorId = 'user:model-run-alias-migration';
  await database
    .insert(schema.platformUsers)
    .values({ id: actorId, kind: 'registered' });
  const [agent] = await database
    .insert(schema.personalAgents)
    .values({ userId: actorId })
    .returning({ id: schema.personalAgents.id });
  if (!agent) throw new Error('测试Agent创建失败');
  const conversation = await new DrizzlePlatformConversationRepository(
    database,
  ).create({
    ownerSubjectId: actorId,
    spaceKind: 'notebook',
    spaceTitle: 'Model Run Alias迁移测试',
  });
  const operationId = randomUUID();
  const assistantMessageId = randomUUID();
  await database.insert(schema.agentOperations).values({
    id: operationId,
    gatewayEnvelopeId: `envelope:${operationId}`,
    requestFingerprint: 'a'.repeat(64),
    actorUserId: actorId,
    agentId: agent.id,
    notebookId: conversation.spaceId,
    conversationId: conversation.id,
    kind: 'turn',
    idempotencyKey: `idempotency:${operationId}`,
    traceId: `trace:${operationId}`,
    status: 'running',
  });
  await database.insert(schema.conversationMessages).values({
    id: assistantMessageId,
    conversationId: conversation.id,
    operationId,
    role: 'assistant',
    status: 'streaming',
    content: '',
    parts: [],
  });
  return { operationId, assistantMessageId };
}

describeWithDatabase('Model Run Alias 0040 additive migration', () => {
  it('从0039升级后保留旧账本并允许有界新Alias与Phase', async () => {
    await withTemporaryDatabase(async (connection) => {
      await withMigrationBundleThrough(39, async (priorMigrationsFolder) => {
        await withMigrationBundleThrough(40, async (targetMigrationsFolder) => {
          const database = drizzle(connection, { schema });
          await migrate(database, {
            migrationsFolder: priorMigrationsFolder,
          });
          const fixture = await createAgentTurnFixture(connection);
          const legacyRunId = randomUUID();
          await connection`
            insert into model_runs (
              id, operation_id, operation_kind, agent_operation_id,
              conversation_message_id, phase, trace_id, task_alias, model_alias,
              prompt_version, prompt_hash, status
            ) values (
              ${legacyRunId}, ${fixture.operationId}, 'agent_turn',
              ${fixture.operationId}, ${fixture.assistantMessageId}, 'answer',
              ${`trace:${fixture.operationId}`}, 'agent.turn', 'primary',
              'agent-general-v2', ${'b'.repeat(64)}, 'pending'
            )
          `;
          const legacyBefore = await connection`
            select id, phase, task_alias, model_alias
            from model_runs
            where id = ${legacyRunId}
          `;

          await migrate(database, {
            migrationsFolder: targetMigrationsFolder,
          });

          expect(
            await connection`
              select id, phase, task_alias, model_alias
              from model_runs
              where id = ${legacyRunId}
            `,
          ).toEqual(legacyBefore);
          await connection`
            insert into model_runs (
              operation_id, operation_kind, agent_operation_id,
              conversation_message_id, phase, trace_id, task_alias, model_alias,
              prompt_version, prompt_hash, status
            ) values (
              ${fixture.operationId}, 'agent_turn', ${fixture.operationId},
              ${fixture.assistantMessageId}, 'reflection_v2',
              ${`trace:${fixture.operationId}`}, 'agent.reflect-v2', 'reasoner.v2',
              'agent-reflection-v1', ${'c'.repeat(64)}, 'pending'
            )
          `;
          expect(
            await connection`
              select phase, task_alias, model_alias
              from model_runs
              where operation_id = ${fixture.operationId}
                and phase = 'reflection_v2'
            `,
          ).toEqual([
            {
              phase: 'reflection_v2',
              task_alias: 'agent.reflect-v2',
              model_alias: 'reasoner.v2',
            },
          ]);

          await expect(
            connection`
              insert into model_runs (
                operation_id, operation_kind, agent_operation_id,
                conversation_message_id, phase, trace_id, task_alias,
                model_alias, prompt_version, prompt_hash, status
              ) values (
                ${fixture.operationId}, 'agent_turn', ${fixture.operationId},
                ${fixture.assistantMessageId}, 'invalid_task',
                ${`trace:${fixture.operationId}`}, '9invalid', 'primary',
                'agent-v1', ${'d'.repeat(64)}, 'pending'
              )
            `,
          ).rejects.toMatchObject({
            code: '23514',
            constraint_name: 'model_runs_text_check',
          });
          await expect(
            connection`
              insert into model_runs (
                operation_id, operation_kind, agent_operation_id,
                conversation_message_id, phase, trace_id, task_alias,
                model_alias, prompt_version, prompt_hash, status
              ) values (
                ${fixture.operationId}, 'agent_turn', ${fixture.operationId},
                ${fixture.assistantMessageId}, 'empty_task',
                ${`trace:${fixture.operationId}`}, '', 'primary',
                'agent-v1', ${'1'.repeat(64)}, 'pending'
              )
            `,
          ).rejects.toMatchObject({
            code: '23514',
            constraint_name: 'model_runs_text_check',
          });
          await expect(
            connection`
              insert into model_runs (
                operation_id, operation_kind, agent_operation_id,
                conversation_message_id, phase, trace_id, task_alias,
                model_alias, prompt_version, prompt_hash, status
              ) values (
                ${fixture.operationId}, 'agent_turn', ${fixture.operationId},
                ${fixture.assistantMessageId}, 'long_model',
                ${`trace:${fixture.operationId}`}, 'agent.turn',
                ${`m${'a'.repeat(64)}`}, 'agent-v1', ${'2'.repeat(64)}, 'pending'
              )
            `,
          ).rejects.toMatchObject({
            code: '23514',
            constraint_name: 'model_runs_text_check',
          });
          await expect(
            connection`
              insert into model_runs (
                operation_id, operation_kind, agent_operation_id,
                conversation_message_id, phase, trace_id, task_alias,
                model_alias, prompt_version, prompt_hash, status
              ) values (
                ${fixture.operationId}, 'agent_turn', ${fixture.operationId},
                ${fixture.assistantMessageId}, 'Bad Phase',
                ${`trace:${fixture.operationId}`}, 'agent.turn', 'primary',
                'agent-v1', ${'e'.repeat(64)}, 'pending'
              )
            `,
          ).rejects.toMatchObject({
            code: '23514',
            constraint_name: 'model_runs_phase_check',
          });
          await expect(
            connection`
              insert into model_runs (
                operation_id, operation_kind, agent_operation_id,
                conversation_message_id, turn_id, phase, trace_id, task_alias,
                model_alias, prompt_version, prompt_hash, status
              ) values (
                ${fixture.operationId}, 'agent_turn', ${fixture.operationId},
                ${fixture.assistantMessageId}, ${fixture.operationId},
                'invalid_shape', ${`trace:${fixture.operationId}`},
                'agent.turn', 'primary', 'agent-v1', ${'f'.repeat(64)}, 'pending'
              )
            `,
          ).rejects.toMatchObject({
            code: '23514',
            constraint_name: 'model_runs_operation_shape_check',
          });

          /* Drizzle journal必须让重复执行成为no-op，不重复DROP/ADD约束。 */
          await migrate(database, {
            migrationsFolder: targetMigrationsFolder,
          });
        });
      });
    });
  });
});
