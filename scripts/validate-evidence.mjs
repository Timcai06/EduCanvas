#!/usr/bin/env node

/**
 * Release Evidence Pack Validator
 *
 * Validates that the release evidence pack contains all required fields,
 * links, and result files. Used in CI to gate RC releases.
 *
 * Q06：状态语义门禁（docs/06-quality/08-供应链与发布证据.md 第六节）——
 * 1. 任何 gate / budget / migration / supply_chain 项 status = failed → 校验失败；
 * 2. skipped 是独立状态，绝不等于通过：skipped 必须有 skipped_reason /
 *    note 说明，且汇总输出中独立计数（skipped 不计入 passed）；
 * 3. passed 与数字一致：带 total/passed 的 gate 若写 passed，必须
 *    passed === total（total = 0 且写 passed = 没跑却写通过 → 失败）；
 * 4. budget 项写 passed 时 actual <= limit 且 actual > 0（0 = 没跑）；
 * 5. migration.version 必须与磁盘迁移文件数一致（可追溯到迁移目录）；
 * 6. 整体 status 写 passed 时，所有 gate / supply_chain 必须已是终态
 *    （不允许 pending/running 冒充通过）。
 *
 * Usage:
 *   node scripts/validate-evidence.mjs [manifest-path]
 *
 * Exit codes:
 *   0 - All validations passed
 *   1 - Validation failed
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const manifestPath =
  process.argv[2] ||
  resolve(repoRoot, 'docs/06-quality/releases/rc1/manifest.json');

const TERMINAL = new Set(['passed', 'failed', 'skipped']);

function loadJSON(path) {
  if (!existsSync(path)) {
    console.error(`❌ File not found: ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    console.error(`❌ Failed to parse ${path}: ${e.message}`);
    return null;
  }
}

function validateRequiredFields(manifest) {
  const errors = [];
  const required = ['release', 'version', 'status', 'baseline', 'gates'];

  for (const field of required) {
    if (!manifest[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (manifest.baseline) {
    if (!manifest.baseline.sha) errors.push('Missing baseline.sha');
    if (!manifest.baseline.branch) errors.push('Missing baseline.branch');
    if (!manifest.baseline.timestamp) errors.push('Missing baseline.timestamp');
  }

  if (manifest.gates) {
    const requiredGates = [
      'lint',
      'typecheck',
      'unit',
      'build',
      'security',
      'release-evidence',
    ];
    for (const gate of requiredGates) {
      if (!manifest.gates[gate]) {
        errors.push(`Missing gate: ${gate}`);
      } else if (!manifest.gates[gate].status) {
        errors.push(`Gate ${gate} missing status`);
      }
    }
  }

  return errors;
}

function validateEvidenceFiles(manifest) {
  const errors = [];
  const evidenceDir = resolve(repoRoot, 'docs/06-quality/releases/rc1');

  if (manifest.evidence) {
    for (const [key, path] of Object.entries(manifest.evidence)) {
      const fullPath = resolve(evidenceDir, path);
      if (!existsSync(fullPath)) {
        errors.push(`Evidence file not found: ${key} -> ${path}`);
      }
    }
  }

  return errors;
}

function validateGateStatuses(manifest) {
  const errors = [];
  const validStatuses = ['pending', 'running', 'passed', 'failed', 'skipped'];

  if (manifest.gates) {
    for (const [name, gate] of Object.entries(manifest.gates)) {
      if (!validStatuses.includes(gate.status)) {
        errors.push(`Gate ${name} has invalid status: ${gate.status}`);
      }
    }
  }

  return errors;
}

function validateTimestamps(manifest) {
  const errors = [];
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

  if (
    manifest.baseline?.timestamp &&
    !isoRegex.test(manifest.baseline.timestamp)
  ) {
    errors.push('baseline.timestamp is not ISO 8601 format');
  }

  if (manifest.gates) {
    for (const [name, gate] of Object.entries(manifest.gates)) {
      if (gate.timestamp && !isoRegex.test(gate.timestamp)) {
        errors.push(`Gate ${name} timestamp is not ISO 8601 format`);
      }
    }
  }

  return errors;
}

/**
 * Q06：状态语义门禁（规则 1–3）。
 * - failed 即失败；
 * - skipped 必须有理由（skipped_reason / note），且绝不计入 passed；
 * - passed 与数字一致（有 total/passed 时 passed === total，total > 0）。
 */
function validateStatusSemantics(entries, scope, errors) {
  for (const [name, entry] of Object.entries(entries)) {
    if (!entry || typeof entry !== 'object') continue;
    const status = entry.status;
    if (!status) continue;

    if (status === 'failed') {
      errors.push(`${scope} ${name} failed：failed 即失败，不允许发布`);
      continue;
    }
    if (status === 'skipped') {
      if (!entry.skipped_reason && !entry.note) {
        errors.push(
          `${scope} ${name} skipped 但没有 skipped_reason/note：` +
            'skipped 必须诚实声明原因，且绝不计入 passed',
        );
      }
      continue;
    }
    if (status === 'passed') {
      // 有数字的 gate：passed 意味着全过。
      if ('total' in entry || 'passed' in entry) {
        const total = entry.total ?? 0;
        const passed = entry.passed ?? 0;
        if (total <= 0) {
          errors.push(
            `${scope} ${name} 写 passed 但 total=${total}：` +
              '没跑过测试不允许写成通过',
          );
        } else if (passed !== total) {
          errors.push(
            `${scope} ${name} 写 passed 但 passed(${passed}) !== total(${total})：` +
              '部分通过必须写 failed 或如实填数',
          );
        }
      }
    }
  }
}

/**
 * Q06：budget（SLO）语义门禁（规则 4）。
 * passed 时 actual <= limit 且 actual > 0；failed 即失败；skipped 需理由。
 */
function validateBudgetSemantics(manifest, errors) {
  const budget = manifest.budget;
  if (!budget || typeof budget !== 'object') return;
  for (const [name, item] of Object.entries(budget)) {
    if (!item || typeof item !== 'object' || !item.status) continue;
    if (item.status === 'failed') {
      errors.push(`budget ${name} failed：SLO 未达成，不允许发布`);
    } else if (item.status === 'skipped' && !item.note) {
      errors.push(`budget ${name} skipped 但没有 note 说明原因`);
    } else if (item.status === 'passed') {
      if (!(item.actual > 0)) {
        errors.push(
          `budget ${name} 写 passed 但 actual=${item.actual}：` +
            '0 表示没测量，不允许写成通过',
        );
      } else if (item.limit > 0 && item.actual > item.limit) {
        errors.push(
          `budget ${name} 写 passed 但 actual(${item.actual}) 超 limit(${item.limit})：` +
            '超限必须写 failed',
        );
      }
    }
  }
}

/**
 * Q06：迁移记录语义门禁（规则 5）。
 * migration.version 必须与磁盘迁移文件数一致；fresh/upgrade 状态语义同 gate。
 */
function validateMigrationSemantics(manifest, errors) {
  const migration = manifest.migration;
  if (!migration) return;
  const drizzleDir = join(repoRoot, 'packages/db/drizzle');
  if (!existsSync(drizzleDir)) {
    errors.push(`migration：找不到 ${drizzleDir}，无法核对版本`);
    return;
  }
  const count = readdirSync(drizzleDir).filter((f) =>
    f.endsWith('.sql'),
  ).length;
  if (migration.version !== count) {
    errors.push(
      `migration.version=${migration.version} 与磁盘迁移数 ${count} 不一致：` +
        'manifest 陈旧或迁移未记录（MIGRATIONS.md 门禁会拒绝新增无记录迁移）',
    );
  }
  for (const kind of ['fresh', 'upgrade']) {
    const item = migration[kind];
    if (!item?.status) continue;
    if (item.status === 'failed') {
      errors.push(`migration.${kind} failed：迁移验证未通过，不允许发布`);
    } else if (item.status === 'skipped' && !item.note) {
      errors.push(`migration.${kind} skipped 但没有 note 说明原因`);
    }
  }
}

/**
 * Q06：供应链结果聚合（规则 6 + 语义同 gate）。
 * 新增 supply_chain 段：actions_pinned / dependency_review / container_digest /
 * migration_records，发布时必须全部终态且无 failed。
 */
function validateSupplyChain(manifest, errors) {
  const supply = manifest.supply_chain;
  if (!supply || typeof supply !== 'object') {
    // supply_chain 段为 Q06 新增，缺段不阻塞旧包，但写 passed 时必须有。
    return;
  }
  validateStatusSemantics(supply, 'supply_chain', errors);
}

/**
 * Q06：整体 status 一致性（规则 6）。
 * manifest.status = passed 时，所有 gate 与 supply_chain 项必须已是终态，
 * 不允许 pending/running 冒充通过。
 */
function validateFinality(manifest, errors) {
  if (manifest.status !== 'passed') return;
  for (const [scope, entries] of [
    ['gate', manifest.gates ?? {}],
    ['supply_chain', manifest.supply_chain ?? {}],
  ]) {
    for (const [name, entry] of Object.entries(entries)) {
      if (entry?.status && !TERMINAL.has(entry.status)) {
        errors.push(
          `整体 status=passed 但 ${scope} ${name} 仍为 ${entry.status}：` +
            '全部项必须终态才能声明通过',
        );
      }
    }
  }
}

// Main validation
console.log('🔍 Validating release evidence pack...\n');
console.log(`Manifest: ${manifestPath}\n`);

const manifest = loadJSON(manifestPath);
if (!manifest) {
  process.exit(1);
}

const errors = [
  ...validateRequiredFields(manifest),
  ...validateEvidenceFiles(manifest),
  ...validateGateStatuses(manifest),
  ...validateTimestamps(manifest),
];
validateStatusSemantics(manifest.gates ?? {}, 'gate', errors);
validateBudgetSemantics(manifest, errors);
validateMigrationSemantics(manifest, errors);
validateSupplyChain(manifest, errors);
validateFinality(manifest, errors);

if (errors.length === 0) {
  console.log('✅ All validations passed!\n');

  // Summary
  console.log('Summary:');
  console.log(`  Release: ${manifest.release}`);
  console.log(`  Version: ${manifest.version}`);
  console.log(`  Status: ${manifest.status}`);
  console.log(`  Baseline: ${manifest.baseline?.sha?.slice(0, 8) || 'N/A'}`);

  // Q06：状态计数——skipped 独立计数，绝不计入 passed。
  const countStatuses = (entries) => {
    const c = { passed: 0, skipped: 0, failed: 0, pending: 0 };
    for (const entry of Object.values(entries)) {
      if (entry?.status === 'passed') c.passed += 1;
      else if (entry?.status === 'skipped') c.skipped += 1;
      else if (entry?.status === 'failed') c.failed += 1;
      else c.pending += 1;
    }
    return c;
  };
  const gateCounts = countStatuses(manifest.gates ?? {});
  const supplyCounts = countStatuses(manifest.supply_chain ?? {});
  const totalGates = Object.keys(manifest.gates ?? {}).length;
  console.log(
    `  Gates: ${gateCounts.passed}/${totalGates} passed` +
      `（skipped ${gateCounts.skipped} 独立计，不计入通过；` +
      `failed ${gateCounts.failed}；pending/running ${gateCounts.pending}）`,
  );
  if (Object.keys(manifest.supply_chain ?? {}).length) {
    console.log(
      `  Supply chain: ${supplyCounts.passed} passed` +
        `（skipped ${supplyCounts.skipped} 独立计，不计入通过）`,
    );
  }

  process.exit(0);
} else {
  console.error(`❌ Validation failed with ${errors.length} error(s):\n`);
  for (const error of errors) {
    console.error(`  • ${error}`);
  }
  process.exit(1);
}
