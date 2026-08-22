import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const GATE = fileURLToPath(new URL('./migration-records.mjs', import.meta.url));

/**
 * D06 原子交付 B：Migration 记录完整性门禁正反测试。
 * 构造临时 drizzle 目录（归档基线 + 新迁移），验证 8 字段契约与占位词 fail closed。
 */

// 必须是 migration-records.mjs 真实 BASELINE 内的文件名（0000–0050 归档基线）
const BASELINE = [
  '0000_careless_lady_bullseye.sql',
  '0001_light_the_initiative.sql',
];

const NEW_RECORD_FIELDS = {
  状态: 'active（D06 测试记录）',
  语义: '测试迁移：新增一列并更新唯一约束。',
  锁表: 'ADD COLUMN 取 ACCESS EXCLUSIVE 短锁；表规模极小。',
  回滚: 'DROP 新增列与约束即可回退。',
  'N-1': '旧应用写入兼容；格式非法值仍被拒绝。',
  'Fresh install': '空库可重放。',
  'Data migration': 'backfill——新列 NOT NULL DEFAULT 自动回填存量行。',
  'Estimated scale': '本地 0 行；生产数据规模未验证，D07 承接。',
  风险: '低——无数据迁移。',
};

function fixture(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'd06-records-'));
  const drizzle = join(dir, 'drizzle');
  const meta = join(drizzle, 'meta');
  mkdirSync(meta, { recursive: true });
  for (const f of BASELINE) {
    writeFileSync(join(drizzle, f), '-- legacy\n');
    writeFileSync(
      join(meta, f.replace('.sql', '_snapshot.json')),
      JSON.stringify({ id: f, prevId: null }),
    );
  }
  // 归档基线记录段（6 字段，无 Data migration/Estimated scale）
  const baselineDoc = BASELINE.map((f) => {
    const lines = [
      `## ${f}`,
      '',
      '- 状态: 归档基线（Q06 审计）',
      '- 语义: 历史迁移。',
      '- 锁表: 历史记录。',
      '- 回滚: 历史记录。',
      '- N-1: 历史记录。',
      '- Fresh install: 历史记录。',
      '- 风险: 历史记录。',
    ];
    return lines.join('\n');
  }).join('\n\n');

  const newSql = overrides.newSql ?? '0052_test_migration.sql';
  writeFileSync(join(drizzle, newSql), '-- new\n');
  writeFileSync(
    join(meta, '0052_snapshot.json'),
    JSON.stringify({ id: 's2', prevId: '0001_legacy.sql' }),
  );
  const fields = { ...NEW_RECORD_FIELDS, ...(overrides.fieldOverrides ?? {}) };
  const recordLines = [`## ${newSql}`, ''];
  for (const [k, v] of Object.entries(fields)) {
    recordLines.push(`- ${k}: ${v}`);
  }
  const doc = `${baselineDoc}\n\n${recordLines.join('\n')}\n`;
  writeFileSync(join(drizzle, 'MIGRATIONS.md'), doc);
  return dir;
}

function runGate(dir) {
  try {
    execFileSync(process.execPath, [GATE, join(dir, 'drizzle')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exit: 0, output: '' };
  } catch (error) {
    return { exit: error.status ?? 1, output: String(error.stderr ?? '') };
  }
}

test('完整 8 字段新迁移记录 → pass', () => {
  const dir = fixture();
  const { exit, output } = runGate(dir);
  assert.equal(exit, 0, output);
  rmSync(dir, { recursive: true, force: true });
});

test('归档基线 6 字段（无新字段）→ pass（不追溯补造规模）', () => {
  const dir = fixture();
  const { exit, output } = runGate(dir);
  assert.equal(exit, 0, output);
  rmSync(dir, { recursive: true, force: true });
});

test('新迁移缺 Data migration → fail', () => {
  const dir = fixture({
    fieldOverrides: { 'Data migration': undefined },
  });
  // 需要真正删除字段行
  const drizzle = join(dir, 'drizzle');
  const doc = requireDoc(drizzle);
  const filtered = doc.replace(/- Data migration: [^\n]+\n/, '');
  writeFileSync(join(drizzle, 'MIGRATIONS.md'), filtered);
  const { exit, output } = runGate(dir);
  assert.notEqual(exit, 0);
  assert.ok(output.includes('Data migration'), output);
  rmSync(dir, { recursive: true, force: true });
});

test('新迁移缺 Estimated scale → fail', () => {
  const dir = fixture();
  const drizzle = join(dir, 'drizzle');
  const doc = requireDoc(drizzle);
  writeFileSync(
    join(drizzle, 'MIGRATIONS.md'),
    doc.replace(/- Estimated scale: [^\n]+\n/, ''),
  );
  const { exit, output } = runGate(dir);
  assert.notEqual(exit, 0);
  assert.ok(output.includes('Estimated scale'), output);
  rmSync(dir, { recursive: true, force: true });
});

test('占位词 Data migration=TBD → fail', () => {
  const dir = fixture({
    fieldOverrides: { 'Data migration': 'TBD' },
  });
  const { exit, output } = runGate(dir);
  assert.notEqual(exit, 0);
  assert.ok(output.includes('占位词'), output);
  rmSync(dir, { recursive: true, force: true });
});

test('占位词 Estimated scale=pending → fail', () => {
  const dir = fixture({
    fieldOverrides: { 'Estimated scale': 'pending' },
  });
  const { exit, output } = runGate(dir);
  assert.notEqual(exit, 0);
  assert.ok(output.includes('占位词'), output);
  rmSync(dir, { recursive: true, force: true });
});

test('显式声明生产规模未验证（D07 承接）→ pass', () => {
  const dir = fixture({
    fieldOverrides: {
      'Estimated scale': '本地 0 行；生产数据规模未验证，D07 承接。',
    },
  });
  const { exit, output } = runGate(dir);
  assert.equal(exit, 0, output);
  rmSync(dir, { recursive: true, force: true });
});

function requireDoc(drizzle) {
  return readFileSync(join(drizzle, 'MIGRATIONS.md'), 'utf8');
}
