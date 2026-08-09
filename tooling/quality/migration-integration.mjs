#!/usr/bin/env node
/**
 * Migration integration suite（D06，原子交付 D）。
 *
 * 聚合独立 Migration CI 证据——只跑与 migration 链直接相关的验证，
 * 复用 packages/db 既有 migrations.integration.test.ts（fresh DB → head +
 * N-1 → head + journal/snapshot 链），不复制测试逻辑：
 *
 *   1. 历史 Migration 不可变门禁（migration-governance，base/head 可传参）；
 *   2. migration record completeness（migration-records）；
 *   3. drizzle-kit check（schema/migration drift）；
 *   4. drizzle-kit generate 后确认 "No schema changes, nothing to migrate"；
 *   5. migrations 集成测试（fresh + N-1）；
 *   6. 验证 drizzle 目录未被验证过程修改（无 0054 生成）。
 *
 * 用法：
 *   node tooling/quality/migration-integration.mjs [base] [head]
 *
 * 需要 TEST_DATABASE_URL 指向 disposable/共享集成测试库（本地默认
 * postgresql://educanvas:educanvas@localhost:5433/educanvas_integration）。
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const base = process.argv[2] ?? process.env.MIGRATION_BASE ?? 'origin/main';
const head = process.argv[3] ?? 'HEAD';

function run(label, command, args) {
  process.stdout.write(`[migration-integration] ${label}...\n`);
  try {
    execFileSync(command, args, {
      cwd: repoRoot,
      stdio: ['inherit', 'inherit', 'inherit'],
    });
  } catch {
    process.stderr.write(`[migration-integration] FAILED: ${label}\n`);
    process.exit(1);
  }
}

run('历史 Migration 不可变门禁', process.execPath, [
  'tooling/quality/migration-governance.mjs',
  base,
  head,
]);
run('Migration 记录完整性', process.execPath, [
  'tooling/quality/migration-records.mjs',
]);
run('drizzle-kit check', 'pnpm', [
  '--dir',
  'packages/db',
  'exec',
  'drizzle-kit',
  'check',
]);
// generate 无差异时不产生文件；有差异时 exit 非零或产生 0054（下方 git 检查兜底）。
run('drizzle-kit generate（必须无差异）', 'pnpm', [
  '--dir',
  'packages/db',
  'exec',
  'drizzle-kit',
  'generate',
]);
run('migrations 集成测试（fresh + N-1）', 'pnpm', [
  '--dir',
  'packages/db',
  'exec',
  'vitest',
  'run',
  '--config',
  'vitest.integration.config.ts',
  'src/migrations.integration.test.ts',
]);
// 验证过程不得修改生成物（*.sql / meta/*_snapshot.json / meta/_journal.json）——
// 防止 generate 悄悄产出 0054；MIGRATIONS.md 是人工维护文档，不在检查范围。
try {
  const dirty = execFileSync(
    'git',
    ['status', '--short', '--', 'packages/db/drizzle'],
    { cwd: repoRoot, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter(
      (line) =>
        !line.endsWith('packages/db/drizzle/MIGRATIONS.md') &&
        !line.includes('MIGRATIONS.md'),
    )
    .join('\n');
  if (dirty) {
    process.stderr.write(
      `[migration-integration] FAILED: drizzle 生成物被验证过程修改（可能生成了 0054）：\n${dirty}\n`,
    );
    process.exit(1);
  }
} catch {
  process.stderr.write(
    '[migration-integration] FAILED: 无法检查 drizzle 目录状态\n',
  );
  process.exit(1);
}

process.stdout.write(
  '[migration-integration] 通过：不可变门禁/记录完整性/drift/fresh/N-1 全部绿，无生成物\n',
);
