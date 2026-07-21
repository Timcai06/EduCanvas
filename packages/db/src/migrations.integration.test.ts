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
            'session_source_bindings', 'turn_source_snapshots', 'turn_source_versions',
            'retrieval_candidates', 'message_citations',
            'assets', 'asset_versions', 'agent_message_parts',
            'turn_context_snapshots', 'spaces', 'conversations',
            'agent_operations', 'conversation_messages', 'tool_effects'
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
        'knowledge_chunks',
        'knowledge_documents',
        'knowledge_sources',
        'lesson_sessions',
        'message_citations',
        'model_runs',
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
});
