/**
 * 本地数据库启动与迁移 — 统一状态机的一部分。
 *
 * 设计（见统一日志协议 ADR）：
 * - `docker compose up -d db` 后必须等 `pg_isready` 真正健康，不只看容器存在；
 * - migration 采用 fingerprint skip：指纹 = sha256(迁移源文件 hash + 数据库
 *   system_identifier)。system_identifier 是数据库集群身份（重建/清空数据卷
 *   后变化），避免数据库重建后错误跳过 migration；数据卷保留时容器重建
 *   也不会误重跑；
 * - 不打印数据库连接字符串；失败只输出安全摘要；
 * - 与旧 Windows 脚本共用 `.educanvas-migrate-state.json`，迁移逻辑唯一事实源
 *   收敛到本模块。
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { composeArgs } from './local-compose.mjs';

const MIGRATION_STATE_FILE = '.educanvas-migrate-state.json';

export const defaultRunCommand = (command, args, options = {}) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: 120_000, ...options },
      (error, stdout, stderr) => {
        resolve({
          code: error?.code ?? 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        });
      },
    );
  });

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 递归收集迁移源文件，返回 相对路径 → 内容。 */
async function collectMigrationFiles(root) {
  const files = [];
  const walk = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name));
      } else if (entry.isFile()) {
        files.push(path.join(directory, entry.name));
      }
    }
  };
  await walk(root);
  return files.sort();
}

/**
 * 迁移源指纹：packages/db/drizzle/** 全部文件内容 hash。
 * 任何迁移 SQL/元数据变化都会改变指纹。
 */
export async function computeMigrationFingerprint(
  drizzleRoot = path.join('packages', 'db', 'drizzle'),
) {
  const files = await collectMigrationFiles(drizzleRoot);
  const hash = createHash('sha256');
  for (const file of files) {
    let content = '';
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      content = '';
    }
    hash.update(`${file}\0${content}\0`);
  }
  return hash.digest('hex');
}

/**
 * 数据库实例身份：pg_control_system().system_identifier（集群级、数据卷
 * 清空后变化）。优先用 docker compose exec；失败时回退到 null（跳过 skip
 * 优化，改为每次幂等执行，绝不冒险跳过）。
 */
export async function readDatabaseIdentity({
  runCommand = defaultRunCommand,
} = {}) {
  const result = await runCommand(
    'docker',
    composeArgs(
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'educanvas',
      '-d',
      'educanvas',
      '-tAc',
      'SELECT system_identifier FROM pg_control_system()',
    ),
  );
  if (result.code !== 0) return null;
  const identifier = result.stdout.trim();
  return /^\d+$/.test(identifier) ? identifier : null;
}

function readCachedState(stateFile) {
  if (!existsSync(stateFile)) return null;
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

export function writeMigrationState(stateFile, payload) {
  writeFileSync(stateFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * 等待 docker compose db 服务 pg_isready。
 * 返回 { durationMs }；超时抛错。
 */
export async function waitForDatabaseReady({
  timeoutMs = 60_000,
  sleep = defaultSleep,
  runCommand = defaultRunCommand,
} = {}) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  while (Date.now() < deadline) {
    const result = await runCommand(
      'docker',
      composeArgs('exec', '-T', 'db', 'pg_isready', '-U', 'educanvas'),
    );
    if (result.code === 0) return { durationMs: Date.now() - startedAt };
    await sleep(1_000);
  }
  throw new Error(`数据库在 ${timeoutMs}ms 内未就绪（pg_isready 失败）`);
}

/**
 * 启动数据库容器并等待健康。
 * 返回 { durationMs }；启动失败抛错。
 */
export async function startDatabase({
  runCommand = defaultRunCommand,
  waitReady = waitForDatabaseReady,
} = {}) {
  const startedAt = Date.now();
  const up = await runCommand('docker', composeArgs('up', '-d', 'db'));
  if (up.code !== 0) {
    throw new Error(
      `docker compose up -d db 失败: ${up.stderr.trim() || up.stdout.trim()}`,
    );
  }
  await waitReady({ runCommand });
  return { durationMs: Date.now() - startedAt };
}

/**
 * 迁移主流程：
 * 1. fingerprint + system_identifier 都一致 → skipped（不跑 drizzle-kit）；
 * 2. 否则执行 `pnpm db:migrate`（幂等）并更新状态文件；
 * 3. 身份读取失败时降级为「每次幂等执行」，保证正确性优先于跳过优化。
 *
 * 返回 { status: 'completed' | 'skipped' | 'failed', durationMs, error? }。
 */
export async function runMigrations({
  projectRoot = process.cwd(),
  runCommand = defaultRunCommand,
  fingerprint = computeMigrationFingerprint,
  readIdentity = readDatabaseIdentity,
} = {}) {
  const startedAt = Date.now();
  const stateFile = path.join(projectRoot, MIGRATION_STATE_FILE);
  try {
    const [sourceFingerprint, databaseId] = await Promise.all([
      fingerprint(),
      readIdentity({ runCommand }),
    ]);
    if (databaseId !== null) {
      const cached = readCachedState(stateFile);
      if (
        cached !== null &&
        cached.fingerprint === sourceFingerprint &&
        cached.databaseId === databaseId
      ) {
        return {
          status: 'skipped',
          durationMs: Date.now() - startedAt,
        };
      }
    }
    const result = await runCommand('pnpm', ['db:migrate'], {
      cwd: projectRoot,
    });
    if (result.code !== 0) {
      return {
        status: 'failed',
        durationMs: Date.now() - startedAt,
        error: new Error(
          `db:migrate 退出码 ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
        ),
      };
    }
    if (databaseId !== null) {
      writeMigrationState(stateFile, {
        fingerprint: sourceFingerprint,
        databaseId,
        updatedAt: new Date().toISOString(),
      });
    }
    return { status: 'completed', durationMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/** 数据库容器是否在运行（status 用）。 */
export async function isDatabaseRunning({
  runCommand = defaultRunCommand,
} = {}) {
  const result = await runCommand('docker', composeArgs('ps', '-q', 'db'));
  return result.code === 0 && result.stdout.trim() !== '';
}
