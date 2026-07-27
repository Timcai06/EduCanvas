import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema';

function resolveTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (
    !databaseName.endsWith('_integration') &&
    !databaseName.endsWith('_test')
  ) {
    throw new Error('集成测试拒绝使用非隔离数据库');
  }
  return value;
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const connection = testDatabaseUrl
  ? postgres(testDatabaseUrl, { max: 2 })
  : null;

/**
 * 存在真实生产删除路径的父表。
 *
 * 清单来自 `anonymous-data-lifecycle.ts`、`anonymous-study-data-lifecycle.ts` 与
 * `study-bootstrap-compensator.ts` 中的实际 `delete` 调用；新增删除路径时必须同步
 * 这里，否则新路径引入的顺序扫描不会被发现。判定依据见
 * docs/04-data/fk-index-audit.md。
 */
const DELETED_PARENT_TABLES = [
  'agent_message_parts',
  'agent_operations',
  'artifact_generation_jobs',
  'artifact_versions',
  'artifacts',
  'asset_versions',
  'assets',
  'canvas_artifact_grading_keys',
  'canvas_artifacts',
  'chat_messages',
  'conversation_message_citations',
  'conversation_messages',
  'conversations',
  'diagnostic_attempts',
  'diagnostic_responses',
  'learner_profiles',
  'learning_events',
  'learning_goals',
  'learning_objectives',
  'lesson_sessions',
  'mastery_states',
  'message_citations',
  'model_runs',
  'operation_sources',
  'retrieval_candidates',
  'session_source_bindings',
  'spaces',
  'tool_calls',
  'turn_safety_decisions',
  'turn_source_snapshots',
  'turn_source_versions',
] as const;

describeWithDatabase('外键删除策略与索引审计', () => {
  beforeAll(async () => {
    if (!connection) throw new Error('TEST_DATABASE_URL未设置');
    await migrate(drizzle(connection, { schema }), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  });

  it('父表存在删除路径时，子表必须有以外键列开头的索引', async () => {
    /* 缺索引会让父行删除对子表做顺序扫描：实测 5000 父行/100000 子行的批量删除
       从 4.75 ms 退化到 903 ms，且扫描期间持锁。 */
    const missing = await connection!<
      { child_table: string; cols: string[]; parent_table: string }[]
    >`
      with deleted_parents(relname) as (
        select unnest(${connection!.array([...DELETED_PARENT_TABLES])}::text[])
      ), fk as (
        select con.conname, src.relname as child_table,
          tgt.relname as parent_table, con.conrelid,
          (select array_agg(att.attname order by k.ord)
             from unnest(con.conkey) with ordinality k(attnum, ord)
             join pg_attribute att
               on att.attrelid = con.conrelid and att.attnum = k.attnum) as cols
        from pg_constraint con
        join pg_class src on src.oid = con.conrelid
        join pg_class tgt on tgt.oid = con.confrelid
        where con.contype = 'f' and src.relnamespace = 'public'::regnamespace
      ), lead as (
        select i.indrelid, att.attname as leadcol,
          i.indpred is not null as partial
        from pg_index i
        join pg_attribute att
          on att.attrelid = i.indrelid and att.attnum = (i.indkey::int2[])[0]
      )
      select fk.child_table, fk.cols, fk.parent_table
      from fk
      join deleted_parents dp on dp.relname = fk.parent_table
      where not exists (
        select 1 from lead
        where lead.indrelid = fk.conrelid
          and not lead.partial
          and lead.leadcol = any(fk.cols)
      )
      order by fk.child_table, fk.conname
    `;

    expect(missing).toEqual([]);
  });

  it('不存在被其他索引完全覆盖的重复索引', async () => {
    /* 完全同列同序、或构成其他索引严格左前缀的索引不改变任何查询计划，
       只增加写放大。部分索引与表达式索引不参与比较：它们的适用条件不同。 */
    const redundant = await connection!<
      { tbl: string; redundant: string; covered_by: string }[]
    >`
      with idx as (
        select i.indrelid, c.relname as tbl, ic.relname as idxname,
          i.indisunique, i.indpred is not null as partial,
          (select array_agg(att.attname order by k.ord)
             from unnest((i.indkey::int2[])[0:i.indnkeyatts-1])
               with ordinality k(attnum, ord)
             join pg_attribute att
               on att.attrelid = i.indrelid and att.attnum = k.attnum) as cols
        from pg_index i
        join pg_class c on c.oid = i.indrelid
        join pg_class ic on ic.oid = i.indexrelid
        where c.relnamespace = 'public'::regnamespace
      )
      select a.tbl, a.idxname as redundant, b.idxname as covered_by
      from idx a
      join idx b on a.indrelid = b.indrelid and a.idxname <> b.idxname
      where a.cols is not null and b.cols is not null
        and not a.partial and not b.partial
        and array_length(a.cols, 1) <= array_length(b.cols, 1)
        and b.cols[1:array_length(a.cols, 1)] = a.cols
        and (
          not a.indisunique
          or (a.indisunique and b.indisunique
              and array_length(a.cols, 1) = array_length(b.cols, 1))
        )
      order by a.tbl, a.idxname
    `;

    expect(redundant).toEqual([]);
  });

  it('审计事实类关系不因方便而 cascade', async () => {
    /* 可信学习证据与不可变教材引用必须由显式清理路径按顺序处理，
       不能被父行删除顺手带走。 */
    const policies = await connection!<
      { conname: string; confdeltype: string }[]
    >`
      select conname, confdeltype
      from pg_constraint
      where conname in (
        'learning_events_session_student_fk',
        'lesson_sessions_conversation_id_conversations_id_fk',
        'agent_message_parts_asset_id_assets_id_fk',
        'retrieval_candidates_chunk_document_fk'
      )
      order by conname
    `;

    expect(policies).toEqual([
      /* a = no action，r = restrict；两者都拒绝删除仍被引用的父行。 */
      {
        conname: 'agent_message_parts_asset_id_assets_id_fk',
        confdeltype: 'a',
      },
      {
        conname: 'learning_events_session_student_fk',
        confdeltype: 'r',
      },
      {
        conname: 'lesson_sessions_conversation_id_conversations_id_fk',
        confdeltype: 'r',
      },
      {
        conname: 'retrieval_candidates_chunk_document_fk',
        confdeltype: 'a',
      },
    ]);
  });
});
