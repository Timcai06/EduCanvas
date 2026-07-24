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

/**
 * 运行时构造截止0033的真实Drizzle bundle，避免手工SQL回放绕过journal。
 * 临时目录只包含既有migration的副本，不修改仓库migration或meta。
 */
async function withMigrationBundleThrough0033(
  operation: (folder: string, lastMigrationAt: number) => Promise<void>,
): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), 'educanvas-migrations-0033-'));
  const journal = JSON.parse(
    await readFile(`${migrationsFolder}/meta/_journal.json`, 'utf8'),
  ) as MigrationJournal;
  const entries = journal.entries.filter((entry) => entry.idx <= 33);
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
    const lastMigrationAt = entries.at(-1)?.when;
    if (lastMigrationAt === undefined) throw new Error('0033 journal missing');
    await operation(folder, lastMigrationAt);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function withTemporaryDatabase(
  operation: (connection: ReturnType<typeof postgres>) => Promise<void>,
): Promise<void> {
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL未设置');
  const databaseName = `educanvas_study_plan_${randomUUID().replaceAll('-', '')}_test`;
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

describeWithDatabase('Study Plan 0034 additive migration', () => {
  it('用Drizzle从0033升级并保留既有事实、约束与索引', async () => {
    await withTemporaryDatabase(async (connection) => {
      await withMigrationBundleThrough0033(async (priorMigrationsFolder) => {
        const database = drizzle(connection, { schema });
        await migrate(database, {
          migrationsFolder: priorMigrationsFolder,
        });
        const userId = 'user:migration-study-plan';
        const notebookId = '83000000-0000-4000-8000-000000000001';
        await connection`
          insert into platform_users (id, kind)
          values (${userId}, 'registered')
        `;
        await connection`
          insert into spaces (id, owner_subject_id, kind, title)
          values (${notebookId}, ${userId}, 'notebook', '迁移前Notebook')
        `;
        const userBefore = await connection`
          select id, kind, status from platform_users where id = ${userId}
        `;
        const spaceBefore = await connection`
          select id, owner_subject_id, kind, title
          from spaces where id = ${notebookId}
        `;

        await migrate(database, { migrationsFolder });

        expect(
          await connection`
            select id, kind, status from platform_users where id = ${userId}
          `,
        ).toEqual(userBefore);
        expect(
          await connection`
            select id, owner_subject_id, kind, title
            from spaces where id = ${notebookId}
          `,
        ).toEqual(spaceBefore);
        expect(
          await connection<{ conname: string }[]>`
            select conname
            from pg_constraint
            where conrelid in (
              'learner_profiles'::regclass,
              'learning_goals'::regclass,
              'learning_objectives'::regclass,
              'diagnostic_attempts'::regclass,
              'diagnostic_responses'::regclass
            )
            order by conname
          `,
        ).toEqual(
          expect.arrayContaining([
            {
              conname: 'diagnostic_attempts_goal_id_learning_goals_id_fk',
            },
            {
              conname: 'diagnostic_attempts_session_id_lesson_sessions_id_fk',
            },
            { conname: 'diagnostic_attempts_shape_check' },
            { conname: 'diagnostic_responses_attempt_id_question_id_pk' },
            {
              conname:
                'diagnostic_responses_objective_id_learning_objectives_id_fk',
            },
            {
              conname: 'learner_profiles_student_id_platform_users_id_fk',
            },
            { conname: 'learner_profiles_shape_check' },
            { conname: 'learning_goals_notebook_id_spaces_id_fk' },
            { conname: 'learning_goals_lifecycle_check' },
            {
              conname: 'learning_objectives_goal_id_learning_goals_id_fk',
            },
            { conname: 'learning_objectives_shape_check' },
          ]),
        );
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

        await connection`
          insert into learning_goals (
            notebook_id, student_id, course_slug, course_version, grade_band,
            topic, desired_outcome
          ) values (
            ${notebookId}, ${userId}, 'math', 'v1', 'middle_school',
            '一次函数', '掌握图像与解析式'
          )
        `;
        await expect(
          connection`
            insert into learning_goals (
              notebook_id, student_id, course_slug, course_version, grade_band,
              topic, desired_outcome
            ) values (
              ${notebookId}, ${userId}, 'math', 'v1', 'middle_school',
              '二次函数', '掌握抛物线'
            )
          `,
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          connection`
            insert into diagnostic_attempts (
              client_attempt_id, goal_id, session_id, student_id,
              definition_version, answer_fingerprint,
              attempted_items, correct_items
            ) values (
              ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, ${userId},
              'v1', ${'a'.repeat(64)}, 2, 0
            )
          `,
        ).rejects.toMatchObject({ code: '23514' });
      });
    });
  });

  it('Drizzle升级中途失败时回滚DDL与journal并可前向重跑', async () => {
    await withTemporaryDatabase(async (connection) => {
      await withMigrationBundleThrough0033(
        async (priorMigrationsFolder, lastMigrationAt) => {
          const database = drizzle(connection, { schema });
          await migrate(database, {
            migrationsFolder: priorMigrationsFolder,
          });
          await connection.unsafe('create table learner_profiles (stub text)');

          await expect(
            migrate(database, { migrationsFolder }),
          ).rejects.toMatchObject({ cause: { code: '42P07' } });
          expect(
            await connection<{ table_name: string }[]>`
              select table_name
              from information_schema.tables
              where table_schema = 'public'
                and table_name in (
                  'diagnostic_attempts', 'diagnostic_responses'
                )
            `,
          ).toEqual([]);
          expect(
            await connection<{ created_at: string }[]>`
              select created_at::text
              from drizzle.__drizzle_migrations
              order by created_at desc
              limit 1
            `,
          ).toEqual([{ created_at: String(lastMigrationAt) }]);

          await connection.unsafe('drop table learner_profiles');
          await migrate(database, { migrationsFolder });
          expect(
            await connection<{ table_name: string }[]>`
              select table_name
              from information_schema.tables
              where table_schema = 'public'
                and table_name in (
                  'learner_profiles', 'learning_goals', 'learning_objectives',
                  'diagnostic_attempts', 'diagnostic_responses'
                )
              order by table_name
            `,
          ).toEqual([
            { table_name: 'diagnostic_attempts' },
            { table_name: 'diagnostic_responses' },
            { table_name: 'learner_profiles' },
            { table_name: 'learning_goals' },
            { table_name: 'learning_objectives' },
          ]);
        },
      );
    });
  });
});
