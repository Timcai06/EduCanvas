import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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

function withDatabaseName(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function applyMigrationFile(
  connection: ReturnType<typeof postgres>,
  fileName: string,
): Promise<void> {
  const sqlText = await readFile(`${migrationsFolder}/${fileName}`, 'utf8');
  for (const statement of sqlText.split('--> statement-breakpoint')) {
    if (statement.trim()) await connection.unsafe(statement);
  }
}

async function withTemporaryDatabase(
  operation: (
    connection: ReturnType<typeof postgres>,
    url: string,
  ) => Promise<void>,
): Promise<void> {
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL未设置');
  const databaseName = `educanvas_migration_${randomUUID().replaceAll('-', '')}_test`;
  const admin = postgres(withDatabaseName(testDatabaseUrl, 'postgres'), {
    max: 1,
  });
  await admin.unsafe(`create database "${databaseName}"`);
  const url = withDatabaseName(testDatabaseUrl, databaseName);
  const connection = postgres(url, { max: 1 });
  try {
    await operation(connection, url);
  } finally {
    await connection.end({ timeout: 5 });
    await admin.unsafe(
      `drop database if exists "${databaseName}" with (force)`,
    );
    await admin.end({ timeout: 5 });
  }
}

describeWithDatabase('对话/Agent账本 additive migration', () => {
  it('全新数据库可应用全部迁移并生成最终Schema', async () => {
    await withTemporaryDatabase(async (connection) => {
      await migrate(drizzle(connection, { schema }), { migrationsFolder });
      const tables = await connection<{ table_name: string }[]>`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name in (
            'lesson_sessions', 'chat_messages', 'model_runs', 'tool_calls',
            'turn_safety_decisions', 'knowledge_sources',
            'knowledge_documents', 'knowledge_chunks',
            'knowledge_chunk_embeddings', 'knowledge_embedding_runs',
            'session_source_bindings', 'turn_source_snapshots', 'turn_source_versions',
            'retrieval_candidates', 'message_citations',
            'assets', 'asset_versions', 'agent_message_parts',
            'turn_context_snapshots', 'spaces', 'conversations',
            'agent_operations', 'conversation_messages', 'tool_effects',
            'operation_continuations', 'learner_profiles', 'learning_goals',
            'learning_objectives', 'diagnostic_attempts', 'diagnostic_responses'
          )
        order by table_name
      `;
      expect(tables.map((table) => table.table_name)).toEqual([
        'agent_message_parts',
        'agent_operations',
        'asset_versions',
        'assets',
        'chat_messages',
        'conversation_messages',
        'conversations',
        'diagnostic_attempts',
        'diagnostic_responses',
        'knowledge_chunk_embeddings',
        'knowledge_chunks',
        'knowledge_documents',
        'knowledge_embedding_runs',
        'knowledge_sources',
        'learner_profiles',
        'learning_goals',
        'learning_objectives',
        'lesson_sessions',
        'message_citations',
        'model_runs',
        'operation_continuations',
        'retrieval_candidates',
        'session_source_bindings',
        'spaces',
        'tool_calls',
        'tool_effects',
        'turn_context_snapshots',
        'turn_safety_decisions',
        'turn_source_snapshots',
        'turn_source_versions',
      ]);
      expect(
        await connection<{ conname: string }[]>`
          select conname
          from pg_constraint
          where conname in (
            'diagnostic_attempts_shape_check',
            'diagnostic_responses_attempt_id_question_id_pk',
            'learner_profiles_shape_check',
            'learning_goals_lifecycle_check',
            'learning_objectives_shape_check'
          )
          order by conname
        `,
      ).toEqual([
        { conname: 'diagnostic_attempts_shape_check' },
        { conname: 'diagnostic_responses_attempt_id_question_id_pk' },
        { conname: 'learner_profiles_shape_check' },
        { conname: 'learning_goals_lifecycle_check' },
        { conname: 'learning_objectives_shape_check' },
      ]);
      expect(
        await connection<{ indexname: string }[]>`
          select indexname
          from pg_indexes
          where schemaname = 'public'
            and indexname in (
              'diagnostic_attempts_client_id_unique',
              'learning_goals_notebook_active_unique',
              'learning_objectives_goal_key_unique',
              'learning_objectives_goal_node_unique',
              'learning_objectives_goal_sequence_unique'
            )
          order by indexname
        `,
      ).toEqual([
        { indexname: 'diagnostic_attempts_client_id_unique' },
        { indexname: 'learning_goals_notebook_active_unique' },
        { indexname: 'learning_objectives_goal_key_unique' },
        { indexname: 'learning_objectives_goal_node_unique' },
        { indexname: 'learning_objectives_goal_sequence_unique' },
      ]);
      const statusDefault = await connection<
        { column_default: string | null; is_nullable: string }[]
      >`
        select column_default, is_nullable
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'lesson_sessions'
          and column_name = 'last_activity_at'
      `;
      expect(statusDefault[0]).toMatchObject({ is_nullable: 'NO' });
      expect(statusDefault[0]?.column_default).toContain('now()');
    });
  });

  it('从0043升级时additive装入pgvector并保留既有FTS事实', async () => {
    await withTemporaryDatabase(async (connection) => {
      const priorMigrations = (await readdir(migrationsFolder))
        .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0044_')
        .sort();
      for (const migration of priorMigrations) {
        await applyMigrationFile(connection, migration);
      }
      const sourceId = '44000000-0000-4000-8000-000000000001';
      const documentId = '44000000-0000-4000-8000-000000000002';
      const chunkId = '44000000-0000-4000-8000-000000000003';
      await connection`
        insert into knowledge_sources (
          id, grade_band, course_slug, source_key, title, source_type
        ) values (
          ${sourceId}, 'middle_school', 'vector-migration-course',
          'approved-source', '审核教材', 'pdf'
        )
      `;
      await connection`
        insert into knowledge_documents (
          id, source_id, version, content_hash, object_key,
          parser_version, parse_status, parsed_at
        ) values (
          ${documentId}, ${sourceId}, 1, ${'c'.repeat(64)},
          'courses/vector-migration/document-v1.pdf', 'pdf-text-v1',
          'ready', now()
        )
      `;
      await connection`
        insert into knowledge_chunks (
          id, document_id, chunk_index, content_hash, content
        ) values (
          ${chunkId}, ${documentId}, 0, ${'d'.repeat(64)},
          '反向 传播 更新 权重'
        )
      `;
      expect(
        await connection`
          select extname from pg_extension where extname = 'vector'
        `,
      ).toHaveLength(0);

      await applyMigrationFile(
        connection,
        '0044_pgvector_hybrid_retrieval.sql',
      );

      /* 升级是纯增量：既有 chunk 与 FTS 命中不受影响。 */
      expect(
        await connection`
          select id from knowledge_chunks
          where search_vector @@ websearch_to_tsquery('simple', '反向 传播')
        `,
      ).toEqual([{ id: chunkId }]);
      expect(
        await connection`
          select extname from pg_extension where extname = 'vector'
        `,
      ).toHaveLength(1);
      expect(
        await connection`
          select indexname from pg_indexes
          where schemaname = 'public'
            and indexname in (
              'knowledge_chunks_fts_idx',
              'knowledge_chunk_embeddings_hnsw_idx'
            )
          order by indexname
        `,
      ).toEqual([
        { indexname: 'knowledge_chunk_embeddings_hnsw_idx' },
        { indexname: 'knowledge_chunks_fts_idx' },
      ]);

      /* 重复应用保持幂等：扩展声明用 IF NOT EXISTS，表创建由迁移账本控制。 */
      await connection.unsafe('CREATE EXTENSION IF NOT EXISTS vector');

      const vectorLiteral = `[${new Array<number>(1536)
        .fill(0)
        .map((_value, index) => (index === 0 ? 1 : 0))
        .join(',')}]`;
      await connection`
        insert into knowledge_chunk_embeddings (
          chunk_id, document_id, embedding_model, embedding_model_version,
          dimensions, instruction, chunking_version, chunk_content_hash,
          embedding
        ) values (
          ${chunkId}, ${documentId}, 'embed-fixture', '2026-05-01',
          1536, 'passage:v1', 'pdf-text-v1', ${'d'.repeat(64)},
          ${vectorLiteral}::vector
        )
      `;
      /* 维度不符会撞上库级约束，而不是被静默写入索引列。 */
      await expect(
        connection`
          insert into knowledge_chunk_embeddings (
            chunk_id, document_id, embedding_model, embedding_model_version,
            dimensions, instruction, chunking_version, chunk_content_hash,
            embedding
          ) values (
            ${chunkId}, ${documentId}, 'embed-fixture', '2026-06-01',
            8, 'passage:v1', 'pdf-text-v1', ${'d'.repeat(64)},
            ${vectorLiteral}::vector
          )
        `,
      ).rejects.toMatchObject({ code: '23514' });

      /* 向量是派生物：删除向量不影响 chunk，反向由 cascade 外键保证。
         chunk 本身由既有不可变触发器保护，无法直接删除，因此这里断言的是
         关系语义（复合外键 + cascade）而不是执行一次删除。 */
      await connection`delete from knowledge_chunk_embeddings`;
      expect(
        await connection`select id from knowledge_chunks where id = ${chunkId}`,
      ).toEqual([{ id: chunkId }]);
      expect(
        await connection<{ confdeltype: string }[]>`
          select confdeltype from pg_constraint
          where conname = 'knowledge_chunk_embeddings_chunk_document_fk'
        `,
      ).toEqual([{ confdeltype: 'c' }]);
    });
  });

  it('从0023升级时保留旧教学Model Run并开放agent_turn形状', async () => {
    await withTemporaryDatabase(async (connection) => {
      const priorMigrations = (await readdir(migrationsFolder))
        .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0024_')
        .sort();
      for (const migration of priorMigrations) {
        await applyMigrationFile(connection, migration);
      }
      const sessionId = '76000000-0000-4000-8000-000000000001';
      const assistantMessageId = '76000000-0000-4000-8000-000000000002';
      const turnId = '76000000-0000-4000-8000-000000000003';
      const runId = '76000000-0000-4000-8000-000000000004';
      const leaseId = '76000000-0000-4000-8000-000000000005';
      await connection`
        insert into lesson_sessions (
          id, student_id, grade_band, course_slug, knowledge_node_id,
          state, status
        ) values (
          ${sessionId}, 'migration-model-run-student', 'middle_school',
          'migration-model-run-course', 'node', 'EXPLAIN', 'active'
        )
      `;
      await connection`
        insert into chat_messages (
          id, session_id, turn_id, role, status, lease_id,
          lease_expires_at, heartbeat_at
        ) values (
          ${assistantMessageId}, ${sessionId}, ${turnId}, 'assistant',
          'pending', ${leaseId}, now() + interval '5 minutes', now()
        )
      `;
      await connection`
        insert into model_runs (
          id, session_id, operation_id, operation_kind,
          assistant_message_id, turn_id, phase, attempt, trace_id,
          task_alias, model_alias, prompt_version, prompt_hash, status
        ) values (
          ${runId}, ${sessionId}, ${turnId}, 'teaching_turn',
          ${assistantMessageId}, ${turnId}, 'answer', 1, 'trace:migration',
          'teaching.turn', 'primary', 'teaching-v1', ${'a'.repeat(64)},
          'pending'
        )
      `;

      await applyMigrationFile(connection, '0024_light_viper.sql');
      expect(
        await connection`
          select session_id, operation_kind, agent_operation_id,
            assistant_message_id, conversation_message_id
          from model_runs where id = ${runId}
        `,
      ).toEqual([
        {
          session_id: sessionId,
          operation_kind: 'teaching_turn',
          agent_operation_id: null,
          assistant_message_id: assistantMessageId,
          conversation_message_id: null,
        },
      ]);
      const sessionColumn = await connection<{ is_nullable: string }[]>`
        select is_nullable
        from information_schema.columns
        where table_schema = 'public' and table_name = 'model_runs'
          and column_name = 'session_id'
      `;
      expect(sessionColumn).toEqual([{ is_nullable: 'YES' }]);
    });
  });

  it('从0024升级时保留旧教学Context Snapshot并开放agent_turn形状', async () => {
    await withTemporaryDatabase(async (connection) => {
      const priorMigrations = (await readdir(migrationsFolder))
        .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0025_')
        .sort();
      for (const migration of priorMigrations) {
        await applyMigrationFile(connection, migration);
      }
      const sessionId = '77000000-0000-4000-8000-000000000001';
      const turnId = '77000000-0000-4000-8000-000000000002';
      const snapshotId = '77000000-0000-4000-8000-000000000003';
      await connection`
        insert into lesson_sessions (
          id, student_id, grade_band, course_slug, knowledge_node_id,
          state, status
        ) values (
          ${sessionId}, 'migration-context-student', 'middle_school',
          'migration-context-course', 'node', 'EXPLAIN', 'active'
        )
      `;
      await connection`
        insert into turn_context_snapshots (
          id, session_id, turn_id, builder_version,
          included_message_ids, selected_asset_version_ids,
          omitted_message_count, character_count, context_hash
        ) values (
          ${snapshotId}, ${sessionId}, ${turnId}, 'teaching-context-v1',
          '[]'::jsonb, '[]'::jsonb, 0, 42, ${'b'.repeat(64)}
        )
      `;

      await applyMigrationFile(connection, '0025_perfect_zemo.sql');
      expect(
        await connection`
          select session_id, turn_id, agent_operation_id, builder_version
          from turn_context_snapshots where id = ${snapshotId}
        `,
      ).toEqual([
        {
          session_id: sessionId,
          turn_id: turnId,
          agent_operation_id: null,
          builder_version: 'teaching-context-v1',
        },
      ]);
      const nullableColumns = await connection<
        { column_name: string; is_nullable: string }[]
      >`
        select column_name, is_nullable
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'turn_context_snapshots'
          and column_name in ('session_id', 'turn_id', 'agent_operation_id')
        order by column_name
      `;
      expect(nullableColumns).toEqual([
        { column_name: 'agent_operation_id', is_nullable: 'YES' },
        { column_name: 'session_id', is_nullable: 'YES' },
        { column_name: 'turn_id', is_nullable: 'YES' },
      ]);
    });
  });

  it('从0025升级时保留旧教学Tool Call并开放agent_turn形状', async () => {
    await withTemporaryDatabase(async (connection) => {
      const priorMigrations = (await readdir(migrationsFolder))
        .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0026_')
        .sort();
      for (const migration of priorMigrations) {
        await applyMigrationFile(connection, migration);
      }
      const sessionId = '78000000-0000-4000-8000-000000000001';
      const assistantMessageId = '78000000-0000-4000-8000-000000000002';
      const turnId = '78000000-0000-4000-8000-000000000003';
      const runId = '78000000-0000-4000-8000-000000000004';
      const callId = '78000000-0000-4000-8000-000000000005';
      const leaseId = '78000000-0000-4000-8000-000000000006';
      await connection`
        insert into lesson_sessions (
          id, student_id, grade_band, course_slug, knowledge_node_id,
          state, status
        ) values (
          ${sessionId}, 'migration-tool-student', 'middle_school',
          'migration-tool-course', 'node', 'EXPLAIN', 'active'
        )
      `;
      await connection`
        insert into chat_messages (
          id, session_id, turn_id, role, status, lease_id,
          lease_expires_at, heartbeat_at
        ) values (
          ${assistantMessageId}, ${sessionId}, ${turnId}, 'assistant',
          'pending', ${leaseId}, now() + interval '5 minutes', now()
        )
      `;
      await connection`
        insert into model_runs (
          id, session_id, operation_id, operation_kind,
          assistant_message_id, turn_id, phase, attempt, trace_id,
          task_alias, model_alias, prompt_version, prompt_hash, status
        ) values (
          ${runId}, ${sessionId}, ${turnId}, 'teaching_turn',
          ${assistantMessageId}, ${turnId}, 'answer', 1, 'trace:migration-tool',
          'teaching.turn', 'primary', 'teaching-v1', ${'c'.repeat(64)},
          'pending'
        )
      `;
      await connection`
        insert into tool_calls (
          id, session_id, turn_id, answer_model_run_id,
          provider_tool_call_id, execution_id, request_hash, trace_id,
          tool_name, teaching_state, exposure, effect, argument_summary,
          status
        ) values (
          ${callId}, ${sessionId}, ${turnId}, ${runId},
          'call_migration', 'execution-migration', ${'d'.repeat(64)},
          'trace:migration-tool', 'getStudentState', 'EXPLAIN', 'model',
          'read', ${JSON.stringify({
            schemaVersion: '1',
            kind: 'object',
            byteLength: 2,
            itemCount: 0,
            sha256: 'e'.repeat(64),
          })}::jsonb, 'pending'
        )
      `;

      await applyMigrationFile(connection, '0026_furry_the_call.sql');
      expect(
        await connection`
          select session_id, turn_id, teaching_state, agent_operation_id
          from tool_calls where id = ${callId}
        `,
      ).toEqual([
        {
          session_id: sessionId,
          turn_id: turnId,
          teaching_state: 'EXPLAIN',
          agent_operation_id: null,
        },
      ]);
    });
  });

  it('从0028升级时保留平台事实并新增最小化continuation账本', async () => {
    await withTemporaryDatabase(async (connection) => {
      const priorMigrations = (await readdir(migrationsFolder))
        .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0029_')
        .sort();
      for (const migration of priorMigrations) {
        await applyMigrationFile(connection, migration);
      }
      const actorId = 'user:migration-continuation';
      await connection`
        insert into platform_users (id, kind)
        values (${actorId}, 'registered')
      `;

      await applyMigrationFile(connection, '0029_aspiring_ezekiel_stane.sql');

      expect(
        await connection`
          select id, kind from platform_users where id = ${actorId}
        `,
      ).toEqual([{ id: actorId, kind: 'registered' }]);
      const columns = await connection<
        { column_name: string; data_type: string }[]
      >`
        select column_name, data_type
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'operation_continuations'
        order by ordinal_position
      `;
      expect(columns.map((column) => column.column_name)).toEqual([
        'id',
        'operation_id',
        'sequence',
        'protocol_version',
        'kind',
        'step',
        'approval_id',
        'tool_call_id',
        'adapter_source',
        'resume_ref',
        'status',
        'lease_generation',
        'lease_owner_id',
        'lease_expires_at',
        'heartbeat_at',
        'failure_code',
        'created_at',
        'updated_at',
        'completed_at',
      ]);
      expect(
        columns.some((column) => ['json', 'jsonb'].includes(column.data_type)),
      ).toBe(false);
      expect(
        await connection`
          select indexname from pg_indexes
          where schemaname = 'public'
            and indexname = 'operation_continuations_active_operation_unique'
        `,
      ).toHaveLength(1);
    });
  });

  it('从0003升级时按scope收敛旧重复行并保留原活动时间', async () => {
    await withTemporaryDatabase(async (connection) => {
      for (const migration of [
        '0000_careless_lady_bullseye.sql',
        '0001_light_the_initiative.sql',
        '0002_common_cerebro.sql',
        '0003_wealthy_wildside.sql',
      ]) {
        await applyMigrationFile(connection, migration);
      }

      const oldId = '70000000-0000-4000-8000-000000000001';
      const latestId = '70000000-0000-4000-8000-000000000002';
      const oldUpdatedAt = '2026-04-01T00:00:00.000Z';
      const latestUpdatedAt = '2026-05-01T00:00:00.000Z';
      await connection`
        insert into lesson_sessions (
          id, student_id, grade_band, course_slug, knowledge_node_id,
          state, created_at, updated_at
        ) values
          (
            ${oldId}, 'migration-student', 'middle_school', 'migration-course', null,
            'EXPLAIN', '2026-03-01T00:00:00.000Z', ${oldUpdatedAt}
          ),
          (
            ${latestId}, 'migration-student', 'middle_school', 'migration-course', null,
            'EXPLAIN', '2026-04-15T00:00:00.000Z', ${latestUpdatedAt}
          )
      `;

      await applyMigrationFile(connection, '0004_nifty_spyke.sql');
      const rows = await connection<
        {
          id: string;
          status: string;
          last_activity_at: Date;
          archived_at: Date | null;
        }[]
      >`
        select id, status, last_activity_at, archived_at
        from lesson_sessions
        order by id
      `;
      expect(rows).toMatchObject([
        {
          id: oldId,
          status: 'archived',
          last_activity_at: new Date(oldUpdatedAt),
          archived_at: new Date(oldUpdatedAt),
        },
        {
          id: latestId,
          status: 'active',
          last_activity_at: new Date(latestUpdatedAt),
          archived_at: null,
        },
      ]);

      await expect(
        connection`
          insert into lesson_sessions (
            student_id, grade_band, course_slug, knowledge_node_id, state
          ) values (
            'migration-student', 'middle_school', 'migration-course', null, 'EXPLAIN'
          )
        `,
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('从0004升级时将无lease的活跃Turn和run收敛为interrupted', async () => {
    await withTemporaryDatabase(async (connection) => {
      for (const migration of [
        '0000_careless_lady_bullseye.sql',
        '0001_light_the_initiative.sql',
        '0002_common_cerebro.sql',
        '0003_wealthy_wildside.sql',
        '0004_nifty_spyke.sql',
      ]) {
        await applyMigrationFile(connection, migration);
      }
      const sessionId = '71000000-0000-4000-8000-000000000001';
      const studentMessageId = '71000000-0000-4000-8000-000000000002';
      const assistantMessageId = '71000000-0000-4000-8000-000000000003';
      const turnId = '71000000-0000-4000-8000-000000000004';
      const runId = '71000000-0000-4000-8000-000000000005';
      await connection`
        insert into lesson_sessions (
          id, student_id, grade_band, course_slug, knowledge_node_id,
          state, status
        ) values (
          ${sessionId}, 'lease-migration-student', 'middle_school',
          'lease-migration-course', 'node', 'EXPLAIN', 'active'
        )
      `;
      await connection`
        insert into chat_messages (
          id, session_id, turn_id, client_message_id, request_hash,
          role, status, content, completed_at
        ) values (
          ${studentMessageId}, ${sessionId}, ${turnId}, 'migration-client',
          ${'a'.repeat(64)}, 'student', 'completed', '问题', now()
        )
      `;
      await connection`
        insert into chat_messages (
          id, session_id, turn_id, role, status, content
        ) values (
          ${assistantMessageId}, ${sessionId}, ${turnId},
          'assistant', 'pending', ''
        )
      `;
      await connection`
        insert into model_runs (
          id, session_id, operation_id, operation_kind,
          assistant_message_id, turn_id, phase, attempt, trace_id,
          task_alias, model_alias, prompt_version, prompt_hash, status
        ) values (
          ${runId}, ${sessionId}, ${turnId}, 'teaching_turn',
          ${assistantMessageId}, ${turnId}, 'answer', 1, 'migration-trace',
          'teaching.turn', 'primary', 'v1', ${'b'.repeat(64)}, 'pending'
        )
      `;

      await applyMigrationFile(connection, '0005_exotic_starhawk.sql');
      expect(
        await connection`
          select status, failure_code, lease_id, lease_expires_at
          from chat_messages where id = ${assistantMessageId}
        `,
      ).toMatchObject([
        {
          status: 'interrupted',
          failure_code: 'lease_missing_after_upgrade',
          lease_id: null,
          lease_expires_at: null,
        },
      ]);
      expect(
        await connection`
          select status, error_code from model_runs where id = ${runId}
        `,
      ).toMatchObject([
        {
          status: 'interrupted',
          error_code: 'lease_missing_after_upgrade',
        },
      ]);
      expect(
        await connection`
          select table_name from information_schema.tables
          where table_schema = 'public' and table_name = 'tool_calls'
        `,
      ).toHaveLength(1);
    });
  });

  it('从0010升级时为既有K12会话回填Space和Conversation', async () => {
    await withTemporaryDatabase(async (connection) => {
      for (const migration of [
        '0000_careless_lady_bullseye.sql',
        '0001_light_the_initiative.sql',
        '0002_common_cerebro.sql',
        '0003_wealthy_wildside.sql',
        '0004_nifty_spyke.sql',
        '0005_exotic_starhawk.sql',
        '0006_windy_silver_sable.sql',
        '0007_ambiguous_silver_surfer.sql',
        '0008_k1_snapshot_integrity.sql',
        '0009_slow_shinobi_shaw.sql',
        '0010_tricky_impossible_man.sql',
      ]) {
        await applyMigrationFile(connection, migration);
      }
      const sessionId = '74000000-0000-4000-8000-000000000001';
      await connection`
        insert into lesson_sessions (
          id, student_id, grade_band, course_slug, knowledge_node_id,
          state, status, title
        ) values (
          ${sessionId}, 'backfill-owner', 'middle_school', 'backfill-course',
          'node', 'EXPLAIN', 'active', '既有课程对话'
        )
      `;

      await applyMigrationFile(connection, '0011_legal_nocturne.sql');

      const [row] = await connection<
        {
          conversation_id: string | null;
          space_owner: string;
          conversation_owner: string;
          agent_profile_id: string;
        }[]
      >`
        select
          ls.conversation_id,
          s.owner_subject_id as space_owner,
          c.owner_subject_id as conversation_owner,
          c.agent_profile_id
        from lesson_sessions ls
        join conversations c on c.id = ls.conversation_id
        join spaces s on s.id = c.space_id
        where ls.id = ${sessionId}
      `;
      expect(row).toEqual({
        conversation_id: sessionId,
        space_owner: 'backfill-owner',
        conversation_owner: 'backfill-owner',
        agent_profile_id: 'k12.teacher',
      });
    });
  });

  it('从0005升级时仅新增脱敏安全决策表并保留既有会话', async () => {
    await withTemporaryDatabase(async (connection) => {
      for (const migration of [
        '0000_careless_lady_bullseye.sql',
        '0001_light_the_initiative.sql',
        '0002_common_cerebro.sql',
        '0003_wealthy_wildside.sql',
        '0004_nifty_spyke.sql',
        '0005_exotic_starhawk.sql',
      ]) {
        await applyMigrationFile(connection, migration);
      }
      const sessionId = '72000000-0000-4000-8000-000000000001';
      const turnId = '72000000-0000-4000-8000-000000000002';
      await connection`
        insert into lesson_sessions (
          id, student_id, grade_band, course_slug, knowledge_node_id,
          state, status
        ) values (
          ${sessionId}, ${`anon:v1:${'a'.repeat(64)}`}, 'middle_school',
          'safety-migration-course', 'node', 'EXPLAIN', 'active'
        )
      `;

      await applyMigrationFile(connection, '0006_windy_silver_sable.sql');
      expect(
        await connection`
          select id from lesson_sessions where id = ${sessionId}
        `,
      ).toHaveLength(1);
      await connection`
        insert into turn_safety_decisions (
          session_id, turn_id, phase, policy_version,
          category, action, detector_version
        ) values (
          ${sessionId}, ${turnId}, 'input', 'k12-v1',
          'normal', 'block', 'structural-v1'
        )
      `;
      await expect(
        connection`
          insert into turn_safety_decisions (
            session_id, turn_id, phase, policy_version,
            category, action, detector_version
          ) values (
            ${sessionId}, ${'72000000-0000-4000-8000-000000000003'},
            'input', 'unsafe version', 'normal', 'allow', 'detector-v1'
          )
        `,
      ).rejects.toMatchObject({ code: '23514' });
      const columns = await connection<{ column_name: string }[]>`
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'turn_safety_decisions'
        order by ordinal_position
      `;
      expect(columns.map((column) => column.column_name)).toEqual([
        'session_id',
        'turn_id',
        'phase',
        'policy_version',
        'category',
        'action',
        'detector_version',
        'created_at',
      ]);
      await connection`delete from lesson_sessions where id = ${sessionId}`;
      expect(
        await connection`
          select * from turn_safety_decisions where session_id = ${sessionId}
        `,
      ).toHaveLength(0);
    });
  });

  it('从0006升级时additive新增审核资料、FTS和引用表', async () => {
    await withTemporaryDatabase(async (connection) => {
      for (const migration of [
        '0000_careless_lady_bullseye.sql',
        '0001_light_the_initiative.sql',
        '0002_common_cerebro.sql',
        '0003_wealthy_wildside.sql',
        '0004_nifty_spyke.sql',
        '0005_exotic_starhawk.sql',
        '0006_windy_silver_sable.sql',
      ]) {
        await applyMigrationFile(connection, migration);
      }
      const sessionId = '73000000-0000-4000-8000-000000000001';
      const sourceId = '73000000-0000-4000-8000-000000000002';
      const documentId = '73000000-0000-4000-8000-000000000003';
      const chunkId = '73000000-0000-4000-8000-000000000004';
      await connection`
        insert into lesson_sessions (
          id, student_id, grade_band, course_slug, knowledge_node_id,
          state, status
        ) values (
          ${sessionId}, ${`anon:v1:${'b'.repeat(64)}`}, 'middle_school',
          'fts-migration-course', 'node', 'EXPLAIN', 'active'
        )
      `;

      await applyMigrationFile(connection, '0007_ambiguous_silver_surfer.sql');
      expect(
        await connection`
          select id from lesson_sessions where id = ${sessionId}
        `,
      ).toHaveLength(1);
      await connection`
        insert into knowledge_sources (
          id, grade_band, course_slug, source_key, title, source_type
        ) values (
          ${sourceId}, 'middle_school', 'fts-migration-course',
          'approved-source', '审核教材', 'pdf'
        )
      `;
      await connection`
        insert into knowledge_documents (
          id, source_id, version, content_hash, object_key,
          parser_version, parse_status, parsed_at
        ) values (
          ${documentId}, ${sourceId}, 1, ${'c'.repeat(64)},
          'courses/fts-migration/document-v1.pdf', 'pdf-text-v1',
          'ready', now()
        )
      `;
      await connection`
        insert into knowledge_chunks (
          id, document_id, chunk_index, content_hash, content
        ) values (
          ${chunkId}, ${documentId}, 0, ${'d'.repeat(64)},
          '猫 特征 图像 分类'
        )
      `;
      expect(
        await connection`
          select id from knowledge_chunks
          where search_vector @@ websearch_to_tsquery('simple', '猫 特征')
        `,
      ).toEqual([{ id: chunkId }]);
      expect(
        await connection`
          select indexname from pg_indexes
          where schemaname = 'public'
            and indexname = 'knowledge_chunks_fts_idx'
        `,
      ).toHaveLength(1);
      await expect(
        connection`
          update knowledge_chunks set content = '篡改' where id = ${chunkId}
        `,
      ).rejects.toMatchObject({ code: '23514' });
      expect(
        await connection`
          select extname from pg_extension where extname = 'vector'
        `,
      ).toHaveLength(0);
    });
  });

  it('从0007升级时冻结已有Turn、清除跨文档候选并收紧半空页码', async () => {
    await withTemporaryDatabase(async (connection) => {
      for (const migration of [
        '0000_careless_lady_bullseye.sql',
        '0001_light_the_initiative.sql',
        '0002_common_cerebro.sql',
        '0003_wealthy_wildside.sql',
        '0004_nifty_spyke.sql',
        '0005_exotic_starhawk.sql',
        '0006_windy_silver_sable.sql',
        '0007_ambiguous_silver_surfer.sql',
      ]) {
        await applyMigrationFile(connection, migration);
      }

      const sessionId = '74000000-0000-4000-8000-000000000001';
      const sourceA = '74000000-0000-4000-8000-000000000002';
      const documentA = '74000000-0000-4000-8000-000000000003';
      const chunkA = '74000000-0000-4000-8000-000000000004';
      const sourceB = '74000000-0000-4000-8000-000000000005';
      const documentB = '74000000-0000-4000-8000-000000000006';
      const chunkB = '74000000-0000-4000-8000-000000000007';
      const snapshotId = '74000000-0000-4000-8000-000000000008';
      const candidateId = '74000000-0000-4000-8000-000000000009';
      const turnId = '74000000-0000-4000-8000-000000000010';

      await connection`
        insert into lesson_sessions (
          id, student_id, grade_band, course_slug, knowledge_node_id,
          state, status
        ) values (
          ${sessionId}, 'migration-k1-student', 'middle_school',
          'migration-k1-course', 'node', 'EXPLAIN', 'active'
        )
      `;
      await connection`
        insert into knowledge_sources (
          id, grade_band, course_slug, source_key, title, source_type
        ) values
          (${sourceA}, 'middle_school', 'migration-k1-course', 'source-a', '教材A', 'pdf'),
          (${sourceB}, 'middle_school', 'migration-k1-course', 'source-b', '教材B', 'pdf')
      `;
      await connection`
        insert into knowledge_documents (
          id, source_id, version, content_hash, object_key,
          parser_version, parse_status, parsed_at
        ) values
          (
            ${documentA}, ${sourceA}, 1, ${'a'.repeat(64)},
            'courses/migration-k1/a.pdf', 'pdf-text-v1', 'ready', now()
          ),
          (
            ${documentB}, ${sourceB}, 1, ${'b'.repeat(64)},
            'courses/migration-k1/b.pdf', 'pdf-text-v1', 'ready', now()
          )
      `;
      // 0007 的 CHECK 对一端 NULL 返回 UNKNOWN，因此这条历史异常当时可以写入。
      await connection`
        insert into knowledge_chunks (
          id, document_id, chunk_index, content_hash, content,
          page_start, page_end
        ) values
          (${chunkA}, ${documentA}, 0, ${'c'.repeat(64)}, '教材A片段', null, 5),
          (${chunkB}, ${documentB}, 0, ${'d'.repeat(64)}, '教材B片段', 2, 2)
      `;
      await connection`
        insert into turn_source_versions (
          id, session_id, turn_id, source_id, document_id,
          document_version, content_hash
        ) values (
          ${snapshotId}, ${sessionId}, ${turnId}, ${sourceA}, ${documentA},
          1, ${'a'.repeat(64)}
        )
      `;
      // 0007 只有两个独立 FK，可以把 A 快照与 B chunk 拼成候选。
      await connection`
        insert into retrieval_candidates (
          id, session_id, turn_id, turn_source_version_id, chunk_id,
          retriever, retriever_version, rank, score, query_hash, trace_id
        ) values (
          ${candidateId}, ${sessionId}, ${turnId}, ${snapshotId}, ${chunkB},
          'fixture', 'fixture-v1', 1, 0.5, ${'e'.repeat(64)}, 'trace-forged'
        )
      `;

      await applyMigrationFile(connection, '0008_k1_snapshot_integrity.sql');

      expect(
        await connection`
          select session_id, turn_id from turn_source_snapshots
        `,
      ).toEqual([{ session_id: sessionId, turn_id: turnId }]);
      expect(
        await connection`select id from retrieval_candidates`,
      ).toHaveLength(0);
      expect(
        await connection`
          select page_start, page_end from knowledge_chunks where id = ${chunkA}
        `,
      ).toEqual([{ page_start: null, page_end: null }]);

      await expect(
        connection`
          insert into retrieval_candidates (
            session_id, turn_id, turn_source_version_id, chunk_id, document_id,
            retriever, retriever_version, rank, score, query_hash, trace_id
          ) values (
            ${sessionId}, ${turnId}, ${snapshotId}, ${chunkB}, ${documentA},
            'fixture', 'fixture-v1', 1, 0.5, ${'e'.repeat(64)}, 'trace-forged'
          )
        `,
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        connection`
          insert into knowledge_chunks (
            document_id, chunk_index, content_hash, content, page_start, page_end
          ) values (
            ${documentA}, 1, ${'f'.repeat(64)}, '未来半空页码', null, 6
          )
        `,
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        connection`
          update turn_source_snapshots set created_at = now()
          where session_id = ${sessionId} and turn_id = ${turnId}
        `,
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('从0050升级时只修复已审计孤儿、登记对象删除并建立三条强FK', async () => {
    await withTemporaryDatabase(async (connection) => {
      const priorMigrations = (await readdir(migrationsFolder))
        .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0051_')
        .sort();
      for (const migration of priorMigrations) {
        await applyMigrationFile(connection, migration);
      }

      const studentId = 'd02-k1-student';
      const spaceId = '75000000-0000-4000-8000-000000000001';
      const goodAssetId = '75000000-0000-4000-8000-000000000002';
      const orphanAssetId = 'f488d009-7753-46e7-9367-c83d5036e265';
      const orphanSpaceId = 'eac85d6a-7e4c-44ce-a8d7-4abd9f06d081';
      const orphanVersionId = '75000000-0000-4000-8000-000000000007';
      const orphanRepresentationId = '75000000-0000-4000-8000-000000000008';
      const orphanKeyframeId = '75000000-0000-4000-8000-000000000009';
      const sessionId = '75000000-0000-4000-8000-000000000004';
      const conversationId = '75000000-0000-4000-8000-000000000005';
      const operationId = '75000000-0000-4000-8000-000000000006';

      await connection`
        insert into platform_users (id, kind, status) values
          (${studentId}, 'registered', 'active')
      `;
      await connection`
        insert into spaces (id, owner_subject_id, kind, title, status) values
          (${spaceId}, ${studentId}, 'notebook', 'D02迁移测试空间', 'active')
      `;
      /* 正常 asset 与孤儿 asset 并存：0050 时代两者都合法（space_id 无 FK）。 */
      await connection`
        insert into assets (
          id, owner_subject_id, space_id, scope, kind, origin,
          display_name, status
        ) values
          (${goodAssetId}, ${studentId}, ${spaceId}, 'space', 'document',
           'upload', '正常资产', 'pending'),
          (${orphanAssetId}, ${studentId}, ${orphanSpaceId},
           'space', 'link', 'upload', '孤儿资产', 'pending')
      `;
      await connection`
        insert into asset_versions (
          id, asset_id, kind, mime_type, byte_size, content_hash, status,
          storage_key
        ) values (
          ${orphanVersionId}, ${orphanAssetId}, 'link', 'text/html', 128,
          ${'a'.repeat(64)}, 'ready', 'd02/orphan/source.html'
        )
      `;
      await connection`
        insert into asset_representations (
          id, asset_version_id, kind, mime_type, status,
          derived_storage_key, byte_size, checksum
        ) values (
          ${orphanRepresentationId}, ${orphanVersionId}, 'preview',
          'text/html', 'ready', 'd02/orphan/preview.html', 64,
          ${'b'.repeat(64)}
        )
      `;
      await connection`
        insert into asset_video_keyframes (
          id, asset_version_id, algorithm_version, ordinal,
          timestamp_seconds, storage_key, checksum, byte_size, mime_type
        ) values (
          ${orphanKeyframeId}, ${orphanVersionId}, 'd02-v1', 1, 0,
          'd02/orphan/frame.jpg', ${'c'.repeat(64)}, 32, 'image/jpeg'
        )
      `;
      await connection`
        insert into lesson_sessions (
          id, student_id, grade_band, course_slug, knowledge_node_id,
          state, status
        ) values (
          ${sessionId}, ${studentId}, 'middle_school', 'd02-course',
          'node', 'DIAGNOSE', 'active'
        )
      `;
      await connection`
        insert into conversations (
          id, space_id, owner_subject_id, title, status
        ) values (
          ${conversationId}, ${spaceId}, ${studentId}, 'D02迁移测试会话', 'active'
        )
      `;
      await connection`
        insert into agent_operations (
          id, conversation_id, kind, idempotency_key, trace_id, status
        ) values (
          ${operationId}, ${conversationId}, 'turn', 'd02-idem-key',
          'd02-trace-id', 'completed'
        )
      `;
      await connection`
        insert into turn_usage_budget_outcomes (
          operation_id, profile_id, estimated, estimated_cost_cents,
          model_calls, tool_calls, tool_results_truncated,
          input_tokens, output_tokens, wall_clock_ms
        ) values (
          ${operationId}, 'd02.profile', false, 3, 1, 0, 0, 100, 50, 500
        )
      `;

      await applyMigrationFile(
        connection,
        '0051_d02_core_referential_integrity.sql',
      );

      /* 孤儿 asset 被确定性清理，正常 asset 与三份事实全部保留。 */
      expect(
        await connection`
          select id from assets order by id
        `,
      ).toEqual([{ id: goodAssetId }]);
      expect(
        await connection`
          select source_type, storage_key
          from object_deletion_outbox
          where source_id in (
            ${orphanVersionId}, ${orphanRepresentationId}, ${orphanKeyframeId}
          )
          order by source_type
        `,
      ).toEqual([
        {
          source_type: 'asset_representation',
          storage_key: 'd02/orphan/preview.html',
        },
        {
          source_type: 'asset_version',
          storage_key: 'd02/orphan/source.html',
        },
        {
          source_type: 'asset_video_keyframe',
          storage_key: 'd02/orphan/frame.jpg',
        },
      ]);
      expect(
        await connection`
          select count(*)::int as n from lesson_sessions where id = ${sessionId}
        `,
      ).toEqual([{ n: 1 }]);
      expect(
        await connection`
          select count(*)::int as n from turn_usage_budget_outcomes
          where operation_id = ${operationId}
        `,
      ).toEqual([{ n: 1 }]);
      expect(
        await connection`
          select count(*)::int as n from conversations where id = ${conversationId}
        `,
      ).toEqual([{ n: 1 }]);
      expect(
        await connection`
          select count(*)::int as n from agent_operations where id = ${operationId}
        `,
      ).toEqual([{ n: 1 }]);

      /* 三条强 FK 与 space_id 兜底索引就位；lesson_sessions 为 restrict
         （教学审计保留链，主体删除须显式闭包）。 */
      expect(
        await connection`
          select conname, confdeltype
          from pg_constraint
          where conname in (
            'assets_space_id_spaces_id_fk',
            'lesson_sessions_student_id_platform_users_id_fk',
            'turn_usage_budget_outcomes_operation_id_agent_operations_id_fk'
          )
          order by conname
        `,
      ).toEqual([
        {
          conname: 'assets_space_id_spaces_id_fk',
          confdeltype: 'r',
        },
        {
          conname: 'lesson_sessions_student_id_platform_users_id_fk',
          confdeltype: 'r',
        },
        {
          conname:
            'turn_usage_budget_outcomes_operation_id_agent_operations_id_fk',
          confdeltype: 'c',
        },
      ]);
      expect(
        await connection`
          select indexname from pg_indexes
          where schemaname = 'public' and indexname = 'assets_space_fk_idx'
        `,
      ).toEqual([{ indexname: 'assets_space_fk_idx' }]);

      /* FK 生效后新孤儿被拒绝（23503），教学会话写入要求主体先行。 */
      await expect(
        connection`
          insert into assets (
            id, owner_subject_id, space_id, scope, kind, origin,
            display_name, status
          ) values (
            '77000000-0000-4000-8000-000000000001', ${studentId},
            '76000000-0000-4000-8000-000000000002', 'space', 'link',
            'upload', '新孤儿', 'pending'
          )
        `,
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        connection`
          insert into lesson_sessions (
            id, student_id, grade_band, course_slug, knowledge_node_id,
            state, status
          ) values (
            '77000000-0000-4000-8000-000000000002', 'no-such-student',
            'middle_school', 'd02-course', 'node', 'DIAGNOSE', 'active'
          )
        `,
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        connection`
          insert into turn_usage_budget_outcomes (
            operation_id, profile_id, estimated, estimated_cost_cents,
            model_calls, tool_calls, tool_results_truncated,
            input_tokens, output_tokens, wall_clock_ms
          ) values (
            '77000000-0000-4000-8000-000000000003', 'd02.profile',
            false, 3, 1, 0, 0, 100, 50, 500
          )
        `,
      ).rejects.toMatchObject({ code: '23503' });
    });
  });

  it('从0050升级时遇到未审计孤儿会在修改数据前 fail-closed', async () => {
    await withTemporaryDatabase(async (connection) => {
      const priorMigrations = (await readdir(migrationsFolder))
        .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0051_')
        .sort();
      for (const migration of priorMigrations) {
        await applyMigrationFile(connection, migration);
      }

      const unexpectedAssetId = '78000000-0000-4000-8000-000000000001';
      const orphanOperationId = '78000000-0000-4000-8000-000000000002';
      await connection`
        insert into assets (
          id, owner_subject_id, space_id, scope, kind, origin,
          display_name, status
        ) values (
          ${unexpectedAssetId}, 'd02-unexpected-owner',
          '78000000-0000-4000-8000-000000000003', 'space', 'link',
          'upload', '未审计孤儿资产', 'pending'
        )
      `;
      await connection`
        insert into lesson_sessions (
          id, student_id, grade_band, course_slug, knowledge_node_id,
          state, status
        ) values (
          '78000000-0000-4000-8000-000000000004', 'd02-missing-student',
          'middle_school', 'd02-course', 'node', 'DIAGNOSE', 'active'
        )
      `;
      await connection`
        insert into turn_usage_budget_outcomes (
          operation_id, profile_id, estimated, estimated_cost_cents,
          model_calls, tool_calls, tool_results_truncated,
          input_tokens, output_tokens, wall_clock_ms
        ) values (
          ${orphanOperationId}, 'd02.profile', false, 3, 1, 0, 0,
          100, 50, 500
        )
      `;

      await expect(
        applyMigrationFile(
          connection,
          '0051_d02_core_referential_integrity.sql',
        ),
      ).rejects.toMatchObject({
        code: '23503',
        message: expect.stringContaining('unexpected_asset_orphans=1'),
      });

      expect(
        await connection`
          select count(*)::int as n from assets where id = ${unexpectedAssetId}
        `,
      ).toEqual([{ n: 1 }]);
      expect(
        await connection`
          select count(*)::int as n
          from pg_constraint
          where conname in (
            'assets_space_id_spaces_id_fk',
            'lesson_sessions_student_id_platform_users_id_fk',
            'turn_usage_budget_outcomes_operation_id_agent_operations_id_fk'
          )
        `,
      ).toEqual([{ n: 0 }]);
    });
  });

  it('从0051升级时开放Vocabulary为格式CHECK并保留既有数据', async () => {
    await withTemporaryDatabase(async (connection) => {
      const priorMigrations = (await readdir(migrationsFolder))
        .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0052_')
        .sort();
      for (const migration of priorMigrations) {
        await applyMigrationFile(connection, migration);
      }

      const owner = 'd03-n1-owner';
      const spaceId = '78000000-0000-4000-8000-000000000001';
      await connection`
        insert into platform_users (id, kind, status) values
          (${owner}, 'registered', 'active')
      `;
      await connection`
        insert into spaces (id, owner_subject_id, kind, title, status) values
          (${spaceId}, ${owner}, 'notebook', 'D03 N-1 空间', 'active')
      `;
      /* 0051 时代：闭集内旧值。 */
      await connection`
        insert into assets (
          id, owner_subject_id, space_id, scope, kind, origin,
          display_name, status
        ) values (
          '78000000-0000-4000-8000-000000000002', ${owner}, ${spaceId},
          'space', 'link', 'upload', '旧资产', 'pending'
        )
      `;

      await applyMigrationFile(connection, '0052_damp_jigsaw.sql');

      /* 旧数据保留；新格式 CHECK 生效：开放值可写入、非法格式拒绝。 */
      expect(
        await connection`
          select count(*)::int as n from assets
          where id = '78000000-0000-4000-8000-000000000002'
        `,
      ).toEqual([{ n: 1 }]);
      await connection`
        insert into assets (
          id, owner_subject_id, space_id, scope, kind, origin,
          display_name, status
        ) values (
          '78000000-0000-4000-8000-000000000003', ${owner}, ${spaceId},
          'space', 'model_3d', 'scanner_import', '新扩展', 'pending'
        )
      `;
      await expect(
        connection`
          insert into assets (
            id, owner_subject_id, space_id, scope, kind, origin,
            display_name, status
          ) values (
            '78000000-0000-4000-8000-000000000004', ${owner}, ${spaceId},
            'space', 'BAD-KIND', 'upload', '非法', 'pending'
          )
        `,
      ).rejects.toMatchObject({ code: '23514' });

      /* D02 三条 FK 仍由 0051 建立（0052 不重复 ADD，fresh install 不冲突）。 */
      expect(
        await connection`
          select count(*)::int as n from pg_constraint
          where conname in (
            'assets_space_id_spaces_id_fk',
            'lesson_sessions_student_id_platform_users_id_fk',
            'turn_usage_budget_outcomes_operation_id_agent_operations_id_fk'
          )
        `,
      ).toEqual([{ n: 3 }]);
    });
  });

  it('从0052升级时派生表示获得多版本身份并保留既有数据', async () => {
    await withTemporaryDatabase(async (connection) => {
      const priorMigrations = (await readdir(migrationsFolder))
        .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0053_')
        .sort();
      for (const migration of priorMigrations) {
        await applyMigrationFile(connection, migration);
      }

      const owner = 'd04-n1-owner';
      const spaceId = '79000000-0000-4000-8000-000000000001';
      await connection`
        insert into platform_users (id, kind, status) values
          (${owner}, 'registered', 'active')
      `;
      await connection`
        insert into spaces (id, owner_subject_id, kind, title, status) values
          (${spaceId}, ${owner}, 'notebook', 'D04 N-1 空间', 'active')
      `;
      await connection`
        insert into assets (
          id, owner_subject_id, space_id, scope, kind, origin,
          display_name, status
        ) values (
          '79000000-0000-4000-8000-000000000002', ${owner}, ${spaceId},
          'space', 'image', 'upload', '旧图片', 'processing'
        )
      `;
      await connection`
        insert into asset_versions (
          id, asset_id, kind, mime_type, byte_size, content_hash,
          status, storage_key
        ) values (
          '79000000-0000-4000-8000-000000000003',
          '79000000-0000-4000-8000-000000000002',
          'image', 'image/png', 100, ${'d'.repeat(64)}, 'ready',
          'uploads/legacy.png'
        )
      `;
      await connection`
        update assets set status = 'ready', current_version_id =
          '79000000-0000-4000-8000-000000000003'
        where id = '79000000-0000-4000-8000-000000000002'
      `;
      /* 0052 时代：representation 无 variant/producer 维度（每 kind 一行）。 */
      await connection`
        insert into asset_representations (
          asset_version_id, kind, mime_type, status, derived_storage_key,
          checksum
        ) values (
          '79000000-0000-4000-8000-000000000003', 'thumbnail', 'image/jpeg',
          'ready', 'derived/thumbnail/legacy.jpg', ${'e'.repeat(64)}
        )
      `;

      await applyMigrationFile(connection, '0053_silky_millenium_guard.sql');

      /* 旧行被 DEFAULT backfill 到默认 identity（default/default/v1），数据保留。 */
      expect(
        await connection`
          select kind, variant, producer, producer_version, status
          from asset_representations
          where asset_version_id = '79000000-0000-4000-8000-000000000003'
        `,
      ).toEqual([
        {
          kind: 'thumbnail',
          variant: 'default',
          producer: 'default',
          producer_version: 'v1',
          status: 'ready',
        },
      ]);
      /* 新唯一约束生效：默认 identity 已占用时再插同 identity 被拒，异 identity 并存。 */
      await connection`
        insert into asset_representations (
          asset_version_id, kind, variant, producer, producer_version,
          mime_type, status, derived_storage_key, checksum
        ) values (
          '79000000-0000-4000-8000-000000000003', 'thumbnail',
          'default', 'cloud', 'renderer-a.v1', 'image/jpeg',
          'ready', 'derived/thumbnail/cloud.jpg', ${'f'.repeat(64)}
        )
      `;
      await expect(
        connection`
          insert into asset_representations (
            asset_version_id, kind, variant, producer, producer_version,
            mime_type, status
          ) values (
            '79000000-0000-4000-8000-000000000003', 'thumbnail',
            'default', 'default', 'v1', 'image/jpeg', 'ready'
          )
        `,
      ).rejects.toMatchObject({ code: '23505' });
      /* 非法 producer 格式（大写）被拒。 */
      await expect(
        connection`
          insert into asset_representations (
            asset_version_id, kind, variant, producer, producer_version,
            mime_type, status
          ) values (
            '79000000-0000-4000-8000-000000000003', 'thumbnail',
            'default', 'UPPER', 'v1', 'image/jpeg', 'ready'
          )
        `,
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
