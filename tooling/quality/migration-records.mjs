#!/usr/bin/env node
/**
 * Migration records gate（Q06）。
 *
 * 校验 packages/db/drizzle/MIGRATIONS.md 与 packages/db/drizzle/*.sql 一致：
 * 1. 每个 .sql 迁移文件都有记录段（段标题 = 文件名）；
 * 2. 每个记录段都对应一个真实存在的 .sql（无孤儿段）；
 * 3. 记录段必须包含全部六个字段：语义 / 锁表 / 回滚 / N-1 /
 *    Fresh install / 风险；
 * 4. 归档基线（0000–0050，2026-08-07 审计）：状态必须标注「归档基线」；
 *    基线之外的新迁移：状态不得标注「归档基线」，六个字段必须填写
 *    真实内容（不得为空），缺失即失败。
 *
 * 用法：
 *   node tooling/quality/migration-records.mjs [drizzle 目录]
 *
 * 只在缺失/不一致时非零退出；输出只含文件名与字段标签，不含 SQL 内容。
 */
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DRIZZLE_DIR = process.argv[2] ?? 'packages/db/drizzle';
const MIGRATIONS_DOC = join(DRIZZLE_DIR, 'MIGRATIONS.md');

// 2026-08-07 审计时的归档基线（文件名列表）。此集合之外的文件 = 新迁移，
// 必须由作者显式记录，不允许「归档基线」占位。
const BASELINE = new Set([
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
  '0011_legal_nocturne.sql',
  '0012_wandering_black_queen.sql',
  '0013_nice_cargill.sql',
  '0014_lonely_zaran.sql',
  '0015_public_stardust.sql',
  '0016_daffy_squirrel_girl.sql',
  '0017_new_scourge.sql',
  '0018_married_deathstrike.sql',
  '0019_good_rattler.sql',
  '0020_giant_legion.sql',
  '0021_brief_red_wolf.sql',
  '0022_red_tusk.sql',
  '0023_furry_microbe.sql',
  '0024_light_viper.sql',
  '0025_perfect_zemo.sql',
  '0026_furry_the_call.sql',
  '0027_conscious_risque.sql',
  '0028_glamorous_whistler.sql',
  '0029_aspiring_ezekiel_stane.sql',
  '0030_known_post.sql',
  '0031_clean_songbird.sql',
  '0032_famous_starfox.sql',
  '0033_crazy_misty_knight.sql',
  '0034_dapper_tag.sql',
  '0035_curvy_justin_hammer.sql',
  '0036_empty_banshee.sql',
  '0037_aromatic_true_believers.sql',
  '0038_mighty_shen.sql',
  '0039_little_dreaming_celestial.sql',
  '0040_brave_domino.sql',
  '0041_unusual_paper_doll.sql',
  '0042_absurd_wild_pack.sql',
  '0043_audio_transcription_pipeline.sql',
  '0044_pgvector_hybrid_retrieval.sql',
  '0045_fk_index_audit.sql',
  '0046_video_source_pipeline.sql',
  '0047_illegal_dorian_gray.sql',
  '0048_eminent_thunderball.sql',
  '0049_audio_consent_guards.sql',
  '0050_acoustic_killer_shrike.sql',
]);

const REQUIRED_FIELDS = [
  '语义',
  '锁表',
  '回滚',
  'N-1',
  'Fresh install',
  '风险',
];
const ARCHIVE_MARK = '归档基线';

if (!existsSync(MIGRATIONS_DOC)) {
  process.stderr.write(
    `[migration-records] 缺少 ${MIGRATIONS_DOC}；Q06 要求每个迁移有记录（见 docs/06-quality/08-供应链与发布证据.md）\n`,
  );
  process.exit(1);
}

const errors = [];

/** 解析 MIGRATIONS.md：按标题切段，返回 [{ file, status, fields }] */
function parseRecords(doc) {
  const sections = doc.split(/(?=^#{2,3} .+\.sql$)/m);
  const records = [];
  for (const section of sections) {
    const header = section.match(/^#{2,3} (.+\.sql)\s*$/m);
    if (!header) continue;
    const body = section.slice(section.indexOf('\n') + 1);
    const fields = {};
    for (const field of [...REQUIRED_FIELDS, '状态']) {
      const match = body.match(new RegExp(`^- ${field}: (.+)$`, 'm'));
      if (match) fields[field] = match[1].trim();
    }
    records.push({ file: header[1].trim(), ...fields });
  }
  return records;
}

// 1) 磁盘上的迁移文件全集。
const sqlFiles = readdirSync(DRIZZLE_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

// 2) 解析文档记录。
const docText = readFileSync(MIGRATIONS_DOC, 'utf8');
const records = parseRecords(docText);
const recordedFiles = new Set(records.map((r) => r.file));

// 3) 双向覆盖检查。
for (const f of sqlFiles) {
  if (!recordedFiles.has(f)) {
    errors.push(`迁移 ${f} 在 MIGRATIONS.md 没有记录段（Q06 要求）`);
  }
}
for (const r of records) {
  if (!sqlFiles.includes(r.file)) {
    errors.push(`记录段 ${r.file} 没有对应的 .sql 文件（孤儿段）`);
  }
}

// 4) 字段完整性 + 基线边界检查。
for (const r of records) {
  if (!sqlFiles.includes(r.file)) continue; // 已在上报孤儿段
  for (const field of REQUIRED_FIELDS) {
    if (!(field in r)) {
      errors.push(`${r.file} 缺少字段「${field}」`);
    }
  }
  const isBaseline = BASELINE.has(r.file);
  const isArchived = (r['状态'] ?? '').includes(ARCHIVE_MARK);
  if (isBaseline && !isArchived) {
    errors.push(
      `${r.file} 属于归档基线（0000–0050）但状态未标注「${ARCHIVE_MARK}」；如已升级为作者记录请同步更新门禁基线`,
    );
  }
  if (!isBaseline) {
    if (isArchived) {
      errors.push(
        `${r.file} 是新迁移，不允许使用「${ARCHIVE_MARK}」占位；必须手写完整记录`,
      );
    }
    for (const field of REQUIRED_FIELDS) {
      if (!r[field]) {
        errors.push(`${r.file} 新迁移字段「${field}」为空，必须填写真实内容`);
      }
    }
  }
}

if (errors.length) {
  process.stderr.write(
    `[migration-records] 门禁失败：\n${errors.join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `[migration-records] 通过：${sqlFiles.length} 个迁移均有记录` +
    `（基线 ${[...BASELINE].length} + 新迁移 ${sqlFiles.length - BASELINE.size}），` +
    `字段完整，无孤儿段。\n`,
);
