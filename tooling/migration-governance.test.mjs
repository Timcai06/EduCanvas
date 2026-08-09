import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyMigrationGovernance } from './quality/migration-governance.mjs';

/**
 * D06 原子交付 A：历史 Migration 不可变门禁（临时 Git fixture 真实 base/head 比较）。
 * 不用文件名正则猜测——每个场景都在临时仓库构造真实提交后验证。
 */

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'd06-migration-gov-'));
  const drizzle = join(dir, 'packages/db/drizzle');
  const meta = join(drizzle, 'meta');
  mkdirSync(meta, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  return { dir, drizzle, meta };
}

function commitAll(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

function writeBase(dir, drizzle, meta, count = 2) {
  // 两张历史迁移（0000/0001）作为不可变基线
  for (let i = 0; i < count; i += 1) {
    writeFileSync(
      join(drizzle, `000${i}_historical.sql`),
      `-- migration ${i}\n`,
    );
    writeFileSync(
      join(meta, `000${i}_snapshot.json`),
      JSON.stringify({
        id: `snap-000${i}`,
        prevId: i === 0 ? null : `snap-000${i - 1}`,
        dialect: 'postgresql',
        tables: {},
      }),
    );
  }
  writeFileSync(
    join(meta, '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: [
        {
          idx: 0,
          version: '7',
          when: 1000,
          tag: '0000_historical',
          breakpoints: true,
        },
        {
          idx: 1,
          version: '7',
          when: 2000,
          tag: '0001_historical',
          breakpoints: true,
        },
      ],
    }),
  );
}

function addMigration(
  dir,
  drizzle,
  meta,
  {
    number,
    tag,
    journal = true,
    snapshot = true,
    prevId = undefined,
    journalIdx = null,
  },
) {
  const sql = join(drizzle, `${number}_${tag}.sql`);
  writeFileSync(sql, `-- new migration ${number}\n`);
  if (snapshot) {
    writeFileSync(
      join(meta, `${number}_snapshot.json`),
      JSON.stringify({
        id: `snap-${number}`,
        prevId: prevId === undefined ? `snap-000${Number(number) - 1}` : prevId,
        dialect: 'postgresql',
        tables: {},
      }),
    );
  }
  if (journal) {
    const journalPath = join(meta, '_journal.json');
    const parsed = JSON.parse(readFileSync(journalPath, 'utf8'));
    parsed.entries.push({
      idx: journalIdx ?? parsed.entries.length,
      version: '7',
      when: Date.now(),
      tag: `${number}_${tag}`,
      breakpoints: true,
    });
    writeFileSync(journalPath, JSON.stringify(parsed));
  }
  return sql;
}

function runVerify({ dir, base, head }) {
  return verifyMigrationGovernance({ base, head, cwd: dir });
}

test('历史 SQL 被修改 → fail', () => {
  const { dir, drizzle, meta } = fixture();
  writeBase(dir, drizzle, meta);
  const base = commitAll(dir, 'base');
  writeFileSync(join(drizzle, '0000_historical.sql'), '-- tampered\n');
  const head = commitAll(dir, 'tamper sql');
  const { errors } = runVerify({ dir, base, head });
  assert.ok(
    errors.some((e) =>
      e.includes(
        'immutable sql modified: packages/db/drizzle/0000_historical.sql',
      ),
    ),
    errors.join('; '),
  );
  rmSync(dir, { recursive: true, force: true });
});

test('历史 SQL 被删除 → fail', () => {
  const { dir, drizzle, meta } = fixture();
  writeBase(dir, drizzle, meta);
  const base = commitAll(dir, 'base');
  rmSync(join(drizzle, '0000_historical.sql'));
  const head = commitAll(dir, 'delete sql');
  const { errors } = runVerify({ dir, base, head });
  assert.ok(
    errors.some((e) =>
      e.includes(
        'immutable sql deleted: packages/db/drizzle/0000_historical.sql',
      ),
    ),
    errors.join('; '),
  );
  rmSync(dir, { recursive: true, force: true });
});

test('历史 snapshot 被修改 → fail', () => {
  const { dir, drizzle, meta } = fixture();
  writeBase(dir, drizzle, meta);
  const base = commitAll(dir, 'base');
  writeFileSync(
    join(meta, '0000_snapshot.json'),
    JSON.stringify({
      id: 'snap-0000',
      prevId: null,
      dialect: 'postgresql',
      tables: { x: 1 },
    }),
  );
  const head = commitAll(dir, 'tamper snapshot');
  const { errors } = runVerify({ dir, base, head });
  assert.ok(
    errors.some((e) =>
      e.includes(
        'immutable snapshot modified: packages/db/drizzle/meta/0000_snapshot.json',
      ),
    ),
    errors.join('; '),
  );
  rmSync(dir, { recursive: true, force: true });
});

test('journal 中间项任意字段被修改 → fail', () => {
  const { dir, drizzle, meta } = fixture();
  writeBase(dir, drizzle, meta);
  const base = commitAll(dir, 'base');
  const journalPath = join(meta, '_journal.json');
  const parsed = JSON.parse(readFileSync(journalPath, 'utf8'));
  parsed.entries[0].when = 9999;
  writeFileSync(journalPath, JSON.stringify(parsed));
  const head = commitAll(dir, 'rewrite journal');
  const { errors } = runVerify({ dir, base, head });
  assert.ok(
    errors.some((e) =>
      e.includes('journal entry 0 (0000_historical) changed or removed'),
    ),
    errors.join('; '),
  );
  rmSync(dir, { recursive: true, force: true });
});

test('journal 只追加合法 migration → pass', () => {
  const { dir, drizzle, meta } = fixture();
  writeBase(dir, drizzle, meta);
  const base = commitAll(dir, 'base');
  addMigration(dir, drizzle, meta, { number: '0002', tag: 'new_feature' });
  const head = commitAll(dir, 'append migration');
  const { errors } = runVerify({ dir, base, head });
  assert.deepEqual(errors, []);
  rmSync(dir, { recursive: true, force: true });
});

test('重复 migration 编号 → fail', () => {
  const { dir, drizzle, meta } = fixture();
  writeBase(dir, drizzle, meta);
  const base = commitAll(dir, 'base');
  addMigration(dir, drizzle, meta, { number: '0000', tag: 'collision' });
  const head = commitAll(dir, 'duplicate number');
  const { errors } = runVerify({ dir, base, head });
  assert.ok(
    errors.some((e) => e.includes('duplicate migration number prefix: 0000')),
    errors.join('; '),
  );
  rmSync(dir, { recursive: true, force: true });
});

test('重复 journal idx → fail', () => {
  const { dir, drizzle, meta } = fixture();
  writeBase(dir, drizzle, meta);
  const base = commitAll(dir, 'base');
  addMigration(dir, drizzle, meta, {
    number: '0002',
    tag: 'dup_idx',
    journalIdx: 1,
  });
  const head = commitAll(dir, 'duplicate idx');
  const { errors } = runVerify({ dir, base, head });
  assert.ok(
    errors.some((e) => e.includes('journal idx duplicated')),
    errors.join('; '),
  );
  rmSync(dir, { recursive: true, force: true });
});

test('snapshot prevId 断链 → fail', () => {
  const { dir, drizzle, meta } = fixture();
  writeBase(dir, drizzle, meta);
  const base = commitAll(dir, 'base');
  addMigration(dir, drizzle, meta, {
    number: '0002',
    tag: 'broken_chain',
    prevId: 'snap-unknown',
  });
  const head = commitAll(dir, 'broken prevId');
  const { errors } = runVerify({ dir, base, head });
  assert.ok(
    errors.some((e) => e.includes('snapshot prevId chain broken')),
    errors.join('; '),
  );
  rmSync(dir, { recursive: true, force: true });
});

test('新 migration 缺 SQL/snapshot/journal 任一项 → fail', () => {
  // 缺 snapshot
  {
    const { dir, drizzle, meta } = fixture();
    writeBase(dir, drizzle, meta);
    const base = commitAll(dir, 'base');
    addMigration(dir, drizzle, meta, {
      number: '0002',
      tag: 'no_snap',
      snapshot: false,
    });
    const head = commitAll(dir, 'missing snapshot');
    const { errors } = runVerify({ dir, base, head });
    assert.ok(
      errors.some((e) => e.includes('missing snapshot')),
      errors.join('; '),
    );
    rmSync(dir, { recursive: true, force: true });
  }
  // 缺 journal
  {
    const { dir, drizzle, meta } = fixture();
    writeBase(dir, drizzle, meta);
    const base = commitAll(dir, 'base');
    addMigration(dir, drizzle, meta, {
      number: '0002',
      tag: 'no_journal',
      journal: false,
    });
    const head = commitAll(dir, 'missing journal');
    const { errors } = runVerify({ dir, base, head });
    assert.ok(
      errors.some((e) => e.includes('missing journal entry')),
      errors.join('; '),
    );
    rmSync(dir, { recursive: true, force: true });
  }
  // 缺 SQL（只有 snapshot + journal 的孤儿；addMigration 总会建 sql，故手动构造）
  {
    const { dir, drizzle, meta } = fixture();
    writeBase(dir, drizzle, meta);
    const base = commitAll(dir, 'base');
    writeFileSync(
      join(meta, '0002_snapshot.json'),
      JSON.stringify({
        id: 'snap-0002',
        prevId: 'snap-0001',
        dialect: 'postgresql',
        tables: {},
      }),
    );
    const journalPath = join(meta, '_journal.json');
    const parsed = JSON.parse(readFileSync(journalPath, 'utf8'));
    parsed.entries.push({
      idx: 2,
      version: '7',
      when: Date.now(),
      tag: '0002_orphan_snap',
      breakpoints: true,
    });
    writeFileSync(journalPath, JSON.stringify(parsed));
    const head = commitAll(dir, 'orphan snapshot');
    const { errors } = runVerify({ dir, base, head });
    assert.ok(
      errors.some((e) => e.includes('new snapshot without migration sql')),
      errors.join('; '),
    );
    rmSync(dir, { recursive: true, force: true });
  }
});

test('只有 journal 尾部追加、缺 SQL 与 snapshot → fail', () => {
  const { dir, drizzle, meta } = fixture();
  writeBase(dir, drizzle, meta);
  const base = commitAll(dir, 'base');
  const journalPath = join(meta, '_journal.json');
  const parsed = JSON.parse(readFileSync(journalPath, 'utf8'));
  parsed.entries.push({
    idx: 2,
    version: '7',
    when: Date.now(),
    tag: '0002_journal_only',
    breakpoints: true,
  });
  writeFileSync(journalPath, JSON.stringify(parsed));
  const head = commitAll(dir, 'journal only');
  const { errors } = runVerify({ dir, base, head });
  assert.ok(
    errors.some((e) => e.includes('new journal entry without migration sql')),
    errors.join('; '),
  );
  rmSync(dir, { recursive: true, force: true });
});

test('journal 重复追加历史 migration tag → fail', () => {
  const { dir, drizzle, meta } = fixture();
  writeBase(dir, drizzle, meta);
  const base = commitAll(dir, 'base');
  const journalPath = join(meta, '_journal.json');
  const parsed = JSON.parse(readFileSync(journalPath, 'utf8'));
  parsed.entries.push({
    idx: 2,
    version: '7',
    when: Date.now(),
    tag: '0001_historical',
    breakpoints: true,
  });
  writeFileSync(journalPath, JSON.stringify(parsed));
  const head = commitAll(dir, 'duplicate historical journal tag');
  const { errors } = runVerify({ dir, base, head });
  assert.ok(
    errors.some((e) => e.includes('new journal entry without migration sql')),
    errors.join('; '),
  );
  rmSync(dir, { recursive: true, force: true });
});

test('工作区未提交 journal 修改 → fail', () => {
  const { dir, drizzle, meta } = fixture();
  writeBase(dir, drizzle, meta);
  const base = commitAll(dir, 'base');
  const journalPath = join(meta, '_journal.json');
  const parsed = JSON.parse(readFileSync(journalPath, 'utf8'));
  parsed.entries[0].when = 9999;
  writeFileSync(journalPath, JSON.stringify(parsed));
  const { errors } = runVerify({ dir, base, head: 'HEAD' });
  assert.ok(
    errors.some((e) =>
      e.includes('uncommitted change to immutable migration file'),
    ),
    errors.join('; '),
  );
  rmSync(dir, { recursive: true, force: true });
});

test('缺失/无效 base 时 fail closed', () => {
  const { dir, drizzle, meta } = fixture();
  writeBase(dir, drizzle, meta);
  commitAll(dir, 'base');
  assert.throws(() => runVerify({ dir, base: 'no-such-ref', head: 'HEAD' }));
  rmSync(dir, { recursive: true, force: true });
});
