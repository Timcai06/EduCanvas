#!/usr/bin/env node
/**
 * Migration governance gate（D06，原子交付 A/B）。
 *
 * 快速开发期 Migration 纪律门禁，基于明确的 base/head SHA 做真实 Git 比较：
 *
 * 1. 不可变性（Rule 1）：
 *    - base 已存在的 packages/db/drizzle/*.sql：禁止修改/删除/重命名；
 *    - base 已存在的 packages/db/drizzle/meta/*_snapshot.json：禁止修改/删除/重命名；
 *    - meta/_journal.json：base 的 entries 必须原样保留（内容+顺序），
 *      head 只允许在尾部追加（Rule 3：后合并者 rebase main 后 regenerate）。
 * 2. 新 Migration 成套（Rule 2/3/4）：
 *    - 新 .sql / 新 snapshot / journal entry 必须成套存在；
 *    - migration 数字前缀全局唯一；
 *    - journal idx 唯一且单调递增；
 *    - 新 snapshot 的 prevId 必须指向前一个 snapshot（按编号排序）的 id；
 *    - SQL 文件 stem、journal tag、snapshot 编号必须一致。
 * 3. fail closed：base/head 无法解析时 CI 必须失败；本地输出使用说明。
 *
 * 用法：
 *   node tooling/quality/migration-governance.mjs [base] [head]
 *
 * 缺省 base = origin/main，head = HEAD。另检查工作区对 drizzle 目录的未提交
 * 修改（base 已存在文件被本地改动也会失败——防止未提交内容绕过门禁）。
 *
 * 只输出文件名与规则标签，不输出 SQL/snapshot 内容。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const DRIZZLE = 'packages/db/drizzle';
const SQL_GLOB = `${DRIZZLE}/*.sql`;
const SNAPSHOT_GLOB = `${DRIZZLE}/meta/*_snapshot.json`;
const JOURNAL = `${DRIZZLE}/meta/_journal.json`;

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd: cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** 解析提交引用；失败抛错（fail closed 由调用方处理）。 */
function resolveSha(ref, cwd) {
  return git(['rev-parse', '--verify', `${ref}^{commit}`], cwd).trim();
}

function lsTree(sha, cwd) {
  // git ls-tree 不支持 glob pathspec magic，列出 drizzle 目录后由调用方过滤。
  const out = git(['ls-tree', '--name-only', '-r', sha, '--', DRIZZLE], cwd);
  return out.split('\n').filter(Boolean).sort();
}

function show(sha, path, cwd) {
  try {
    return git(['show', `${sha}:${path}`], cwd);
  } catch {
    return null;
  }
}

function nameStatus(base, head, cwd) {
  // git diff 支持 pathspec，但统一用目录路径 + JS 过滤保持行为一致。
  return git(['diff', '--name-status', base, head, '--', DRIZZLE], cwd);
}

function parseJournal(text) {
  if (!text) return [];
  const parsed = JSON.parse(text);
  return parsed.entries ?? [];
}

/** Drizzle journal tag 使用不带 `.sql` 的 migration 文件 stem。 */
function journalTagForSql(path) {
  return path
    .split('/')
    .pop()
    .replace(/\.sql$/, '');
}

export function verifyMigrationGovernance({ base, head, cwd = repoRoot }) {
  const errors = [];
  const baseSha = resolveSha(base, cwd);
  const headSha = resolveSha(head, cwd);

  const baseAll = lsTree(baseSha, cwd);
  const headAll = lsTree(headSha, cwd);
  const baseSql = baseAll.filter((f) => f.endsWith('.sql'));
  const baseSnapshots = baseAll.filter(
    (f) => f.startsWith(`${DRIZZLE}/meta/`) && f.endsWith('_snapshot.json'),
  );
  const headSql = headAll.filter((f) => f.endsWith('.sql'));
  const headSnapshots = headAll.filter(
    (f) => f.startsWith(`${DRIZZLE}/meta/`) && f.endsWith('_snapshot.json'),
  );

  // ---- 1. 历史 SQL / snapshot 不可变 ----
  for (const line of nameStatus(baseSha, headSha, cwd).split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(/\s+/);
    const status = parts[0];
    const file = parts[parts.length - 1];
    if (!file.endsWith('.sql')) continue;
    if (status.startsWith('R')) {
      errors.push(`immutable sql renamed: ${file}`);
      continue;
    }
    if (status !== 'M' && status !== 'D') continue;
    errors.push(
      `immutable sql ${status === 'M' ? 'modified' : 'deleted'}: ${file}`,
    );
  }
  for (const line of nameStatus(baseSha, headSha, cwd).split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(/\s+/);
    const status = parts[0];
    const file = parts[parts.length - 1];
    if (
      !file.startsWith(`${DRIZZLE}/meta/`) ||
      !file.endsWith('_snapshot.json')
    ) {
      continue;
    }
    if (status.startsWith('R')) {
      errors.push(`immutable snapshot renamed: ${file}`);
      continue;
    }
    if (status !== 'M' && status !== 'D') continue;
    errors.push(
      `immutable snapshot ${status === 'M' ? 'modified' : 'deleted'}: ${file}`,
    );
  }

  // ---- 2. journal：base entries 原样保留 + 只允许尾部追加 ----
  const baseJournal = parseJournal(show(baseSha, JOURNAL, cwd));
  const headJournal = parseJournal(show(headSha, JOURNAL, cwd));
  for (let i = 0; i < baseJournal.length; i += 1) {
    const baseEntry = baseJournal[i];
    const headEntry = headJournal[i];
    if (!headEntry || JSON.stringify(headEntry) !== JSON.stringify(baseEntry)) {
      errors.push(
        `journal entry ${baseEntry.idx} (${baseEntry.tag}) changed or removed; ` +
          `only tail append is allowed (rebase main then regenerate)`,
      );
      break;
    }
  }
  const headIndices = headJournal.map((entry) => entry.idx);
  if (new Set(headIndices).size !== headIndices.length) {
    errors.push('journal idx duplicated');
  }
  for (let i = 1; i < headIndices.length; i += 1) {
    if (headIndices[i] <= headIndices[i - 1]) {
      errors.push('journal idx not monotonically increasing');
      break;
    }
  }

  // ---- 3. 新 migration 成套 + 编号/tag/prevId 一致性 ----
  const newSql = headSql.filter((f) => !baseSql.includes(f));
  const newSnapshots = headSnapshots.filter((f) => !baseSnapshots.includes(f));

  const sqlNumbers = headSql.map(
    (f) =>
      f
        .split('/')
        .pop()
        .match(/^(\d{4})_/)?.[1],
  );
  const seen = new Set();
  for (const num of sqlNumbers) {
    if (!num) continue;
    if (seen.has(num)) errors.push(`duplicate migration number prefix: ${num}`);
    seen.add(num);
  }

  const journalTags = new Set(headJournal.map((entry) => entry.tag));
  const snapshotById = new Map();
  for (const file of headSnapshots) {
    const text = show(headSha, file, cwd);
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      snapshotById.set(file.split('/').pop(), {
        id: parsed.id,
        prevId: parsed.prevId,
      });
    } catch {
      errors.push(`unparseable snapshot: ${file}`);
    }
  }

  for (const file of newSql) {
    const name = file.split('/').pop();
    const number = name.match(/^(\d{4})_/)?.[1];
    if (!number) {
      errors.push(`new migration missing 4-digit number prefix: ${file}`);
      continue;
    }
    const snapshotFile = `${DRIZZLE}/meta/${number}_snapshot.json`;
    if (!headSnapshots.includes(snapshotFile)) {
      errors.push(
        `new migration missing snapshot: ${file} (expected ${snapshotFile})`,
      );
    }
    const expectedJournalTag = journalTagForSql(file);
    if (!journalTags.has(expectedJournalTag)) {
      errors.push(
        `new migration missing journal entry (tag=${expectedJournalTag}): ${file}`,
      );
    }
    if (!baseSql.includes(file)) {
      const snapshotName = `${number}_snapshot.json`;
      const snapshotMeta = snapshotById.get(snapshotName);
      if (snapshotMeta) {
        const prev = findPrevSnapshot(
          headSnapshots,
          number,
          baseSnapshots,
          snapshotById,
        );
        if (prev && snapshotMeta.prevId !== prev.id) {
          errors.push(
            `snapshot prevId chain broken: ${snapshotName} prevId ` +
              `${snapshotMeta.prevId} != previous snapshot ${prev.name} id ${prev.id}`,
          );
        }
      }
    }
  }
  for (const file of newSnapshots) {
    const name = file.split('/').pop();
    const number = name.match(/^(\d{4})_snapshot\.json$/)?.[1];
    // 反查：headSql 中同编号的文件
    const matchedSql = headSql.filter((f) => {
      const n = f
        .split('/')
        .pop()
        .match(/^(\d{4})_/)?.[1];
      return n === number;
    });
    if (matchedSql.length === 0) {
      errors.push(`new snapshot without migration sql: ${file}`);
    }
    if (
      matchedSql.length > 0 &&
      !journalTags.has(journalTagForSql(matchedSql[0]))
    ) {
      errors.push(`new snapshot without journal entry: ${file}`);
    }
  }
  for (const entry of headJournal.slice(baseJournal.length)) {
    const matchedSql = newSql.find(
      (file) => journalTagForSql(file) === entry.tag,
    );
    if (!matchedSql) {
      errors.push(`new journal entry without migration sql: ${entry.tag}`);
      continue;
    }
    const number = matchedSql
      .split('/')
      .pop()
      .match(/^(\d{4})_/)?.[1];
    const snapshotFile = `${DRIZZLE}/meta/${number}_snapshot.json`;
    if (!number || !newSnapshots.includes(snapshotFile)) {
      errors.push(`new journal entry without snapshot: ${entry.tag}`);
    }
  }

  // ---- 4. 工作区未提交的 drizzle 修改（本地保护）----
  if (existsSync(join(cwd, '.git'))) {
    const dirtyFiles = new Set(
      [
        git(['diff', '--name-only', '--', DRIZZLE], cwd),
        git(['diff', '--cached', '--name-only', '--', DRIZZLE], cwd),
      ]
        .join('\n')
        .split('\n')
        .filter(Boolean),
    );
    // 只拦截 base 已存在文件的工作区修改；新增文件由 commit 后门禁处理。
    for (const file of dirtyFiles) {
      if (
        baseSql.includes(file) ||
        baseSnapshots.includes(file) ||
        file === JOURNAL
      ) {
        errors.push(`uncommitted change to immutable migration file: ${file}`);
      }
    }
  }

  return { errors, baseSha, headSha };
}

function findPrevSnapshot(headSnapshots, number, baseSnapshots, snapshotById) {
  const baseLast = baseSnapshots[baseSnapshots.length - 1]?.split('/').pop();
  // 编号 < number 的 head snapshots（含 base 最后一张）
  const candidates = headSnapshots
    .map((f) => f.split('/').pop())
    .filter((name) => {
      const n = name.match(/^(\d{4})_/)?.[1];
      return n && n < number;
    })
    .sort();
  const prevName = candidates[candidates.length - 1] ?? baseLast;
  if (!prevName) return null;
  const meta = snapshotById.get(prevName);
  if (!meta) return null;
  return { name: prevName, id: meta.id };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2] ?? process.env.MIGRATION_BASE ?? 'origin/main';
  const head = process.argv[3] ?? 'HEAD';
  try {
    const { errors, baseSha, headSha } = verifyMigrationGovernance({
      base,
      head,
    });
    if (errors.length) {
      process.stderr.write(
        `[migration-governance] 失败（base=${baseSha} head=${headSha}）：\n` +
          errors.map((e) => `  - ${e}`).join('\n') +
          '\n',
      );
      process.exit(1);
    }
    process.stdout.write(
      `[migration-governance] 通过：base=${baseSha} head=${headSha}，` +
        `历史 SQL/snapshot 不可变、journal 仅合法追加、新 migration 成套\n`,
    );
  } catch (error) {
    process.stderr.write(
      `[migration-governance] 无法解析 base/head（fail closed）：${error.message}\n` +
        `用法：node tooling/quality/migration-governance.mjs [base] [head]\n` +
        `示例：node tooling/quality/migration-governance.mjs origin/main HEAD\n`,
    );
    process.exit(1);
  }
}
