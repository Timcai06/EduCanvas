#!/usr/bin/env node
/**
 * Bundle / route size 检查（Q05）。
 *
 * 测量 Next.js 产物：
 * - `.next/static/chunks/` 下所有 JS chunk 总量与最大 chunk；
 * - `.next/server/app/` 下每路由 SSR HTML 大小（首屏负载代理）。
 *
 * 门禁逻辑（阈值文件 `tooling/quality/bundle-size-baseline.json`）：
 * - 总量 > 基线 × 1.1 或最大 chunk > 基线 × 1.1 → fail；
 * - 基线中存在的路由 HTML > 基线 × 1.1 → fail；
 * - 基线中不存在的“新增路由”：HTML > 300KB 或总 JS 增长 > 1MB → fail
 *   （新增路由必须先经发布评审，不能静默进包）；
 * - 没有基线文件时（--record 或首次）输出数字并提示先记录基线，不 fail。
 *
 * 用法：
 *   node tooling/quality/bundle-size.mjs [--root apps/web] [--record]
 *   --record：把当前实测值写入基线文件（记录基线时用）。
 *
 * 只输出聚合字节数与路由路径，不读取任何用户内容。
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.argv[process.argv.indexOf('--root') + 1] ?? 'apps/web';
const recordMode = process.argv.includes('--record');
const BASELINE_PATH = 'tooling/quality/bundle-size-baseline.json';
const ALLOWED_GROWTH = 1.1;
const NEW_ROUTE_HTML_LIMIT = 300 * 1024;
const NEW_ROUTE_JS_GROWTH_LIMIT = 1024 * 1024;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function measureStaticChunks(nextDir) {
  const chunksDir = join(nextDir, 'static', 'chunks');
  let files = [];
  try {
    files = walk(chunksDir).filter((f) => f.endsWith('.js'));
  } catch {
    files = [];
  }
  const sizes = files.map((f) => ({
    path: relative(nextDir, f),
    bytes: statSync(f).size,
  }));
  return {
    totalBytes: sizes.reduce((sum, f) => sum + f.bytes, 0),
    entry: sizes.sort((a, b) => b.bytes - a.bytes)[0] ?? null,
  };
}

function measureRouteHtml(nextDir) {
  const appDir = join(nextDir, 'server', 'app');
  let files = [];
  try {
    files = walk(appDir).filter((f) => f.endsWith('.html'));
  } catch {
    files = [];
  }
  return files
    .map((f) => ({
      // /login/page.html → /login
      route:
        '/' +
        relative(appDir, f)
          .split(sep)
          .filter((part) => part !== 'page.html' && part !== 'index.html')
          .join('/'),
      bytes: statSync(f).size,
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

const nextDir = join(root, '.next');
const stats = {
  ...measureStaticChunks(nextDir),
  routes: measureRouteHtml(nextDir),
};

const failures = [];
if (recordMode) {
  // #310：基线必须注明构建环境——本地（macOS arm64 + node 24）与 CI
  // （linux x64 + node 22）的 Next 构建产物大小差异可达 10%+，无环境标记的
  // 基线会把环境差异误判为回归（2026-08-07 实测 _not-found.html 11411→15937）。
  const buildEnvironment = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  };
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        recordedAt: new Date().toISOString().slice(0, 10),
        buildEnvironment,
        ...stats,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`bundle-size: 已记录基线 → ${BASELINE_PATH}`);
  console.log(
    `jsTotal=${stats.totalBytes}B entry=${stats.entry?.bytes ?? 0}B routes=${stats.routes.length}`,
  );
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  if (
    baseline.buildEnvironment &&
    (baseline.buildEnvironment.platform !== process.platform ||
      baseline.buildEnvironment.node !== process.version)
  ) {
    console.warn(
      `bundle-size: 警告——基线记录于 ${baseline.buildEnvironment.platform}/${baseline.buildEnvironment.arch} node${baseline.buildEnvironment.node}，当前环境 ${process.platform}/${process.arch} node${process.version}；跨环境产物大小有差异，门禁以记录环境（CI）为准。`,
    );
  }
} catch {
  console.log(
    'bundle-size: 无基线文件。先用 --record 记录基线（Q05 要求先真实基线后设阈值）。',
  );
  console.log(
    `jsTotal=${stats.totalBytes}B entry=${stats.entry?.bytes ?? 0}B routes=${stats.routes.length}`,
  );
  process.exit(0);
}

if (stats.totalBytes > baseline.totalBytes * ALLOWED_GROWTH) {
  failures.push(
    `JS 总量 ${stats.totalBytes}B 超过基线 ${baseline.totalBytes}B 的 ${ALLOWED_GROWTH}×`,
  );
}
if (
  stats.entry &&
  baseline.entry &&
  stats.entry.bytes > baseline.entry.bytes * ALLOWED_GROWTH
) {
  failures.push(
    `最大 chunk ${stats.entry.bytes}B（${stats.entry.path}）超过基线 ${baseline.entry.bytes}B 的 ${ALLOWED_GROWTH}×`,
  );
}
const baselineRoutes = new Map(
  (baseline.routes ?? []).map((r) => [r.route, r.bytes]),
);
for (const route of stats.routes) {
  const prior = baselineRoutes.get(route.route);
  if (prior === undefined) {
    if (route.bytes > NEW_ROUTE_HTML_LIMIT) {
      failures.push(
        `新增路由 ${route.route} HTML ${route.bytes}B 超过 ${NEW_ROUTE_HTML_LIMIT}B`,
      );
    }
  } else if (route.bytes > prior * ALLOWED_GROWTH) {
    failures.push(
      `路由 ${route.route} HTML ${route.bytes}B 超过基线 ${prior}B 的 ${ALLOWED_GROWTH}×`,
    );
  }
}

const lines = [
  '### Bundle / Route Size（Q05）',
  '',
  `JS 总量 ${(stats.totalBytes / 1024).toFixed(1)}KB（${stats.totalBytes}B） | 最大 chunk ${stats.entry ? `${(stats.entry.bytes / 1024).toFixed(1)}KB（${stats.entry.bytes}B，${stats.entry.path}）` : '-'} | 路由 ${stats.routes.length} 个`,
  ...stats.routes
    .slice(0, 8)
    .map(
      (r) => `- ${r.route}: ${(r.bytes / 1024).toFixed(1)}KB（${r.bytes}B）`,
    ),
];
if (failures.length) {
  lines.push(
    '',
    '**bundle-size 检查失败：**',
    ...failures.map((f) => `- ${f}`),
  );
}
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n', {
    flag: 'a',
  });
}
process.exit(failures.length ? 1 : 0);
