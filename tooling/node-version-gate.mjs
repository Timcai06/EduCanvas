#!/usr/bin/env node

// R01 静态门禁：拒绝 workspace 单独漂移 Node 类型或运行时最低版本。
// 项目策略：.nvmrc 是 CI 与本地推荐版本的权威，但 engines 只规定最低版本，
// 不对更新的 Node 主版本制造无依据的安装警告。
// 规则（对根与全部 workspace 包）：
//   1) devDependencies["@types/node"] 的 range 必须严格限定在 .nvmrc 主版本内（如 ^24.13.3、>=24 <25）；
//   2) engines.node 必须等于由 .nvmrc 推导出的最低版本（24.18.0 → >=24.18.0），
//      拒绝更低版本或 workspace 自行漂移，但允许后续 Node 主版本运行。
// 本门禁只校验版本声明一致性，不证明运行能力（esbuild --target、实验性 flag、真实执行仍由
// CI 在 .nvmrc 指定的 Node 版本上验证），因此它不把“版本一致”冒充为“运行已通过”。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.argv[2] ?? process.cwd();

function fail(message) {
  console.error(`[node-version-gate] ${message}`);
  process.exit(1);
}

// 从 .nvmrc 这类裸版本串提取主版本：24.18.0 → 24、v24 → 24。
function leadingMajor(value) {
  const match = String(value).match(/\d+/);
  return match === null ? null : Number(match[0]);
}

// 判定 semver range 是否“严格限定在指定主版本内”：范围的每一种可能版本都属于该主版本。
// 支持 ||（OR）段与空格分隔的 AND comparator；不依赖外部 semver 库，门禁保持自包含。
// 对每个 AND 段计算允许的最低/最高主版本，段内所有 comparator 收敛后仍可能包含其它主版本
// （无上限、下限低于目标、上限低于目标）即不严格。
function rangeStrictlyPinsMajor(range, major) {
  const orSegments = String(range)
    .split('||')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (orSegments.length === 0) return false;
  return orSegments.every((segment) => segmentPinsMajor(segment, major));
}

// 单个 AND 段的 comparator 集合收敛后是否恰好落在目标主版本内。
const COMPARATOR_RE =
  /(>=|<=|>|<|~|\^|=)?\s*v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?/g;

function segmentPinsMajor(segment, major) {
  let minMajor = 0;
  let maxMajor = Number.POSITIVE_INFINITY;
  let matched = false;
  for (const m of segment.matchAll(COMPARATOR_RE)) {
    matched = true;
    const op = m[1] ?? '';
    const rawMajor = m[2];
    // 通配主版本（*、x、x.x.x）没有主版本约束，段不可能收敛到单一主版本。
    if (/[xX*]/.test(rawMajor)) return false;
    const comparatorMajor = Number(rawMajor);
    const minorIsNumber = m[3] !== undefined && !/[xX*]/.test(m[3]);
    const patchIsNumber = m[4] !== undefined && !/[xX*]/.test(m[4]);
    switch (op) {
      case '>=':
      case '>':
        minMajor = Math.max(minMajor, comparatorMajor);
        break;
      case '<':
        // <23 → 最高允许主版本 22；<22.6 → 最高允许主版本 22（22.5.x 仍在 22 内）。
        maxMajor = Math.min(
          maxMajor,
          minorIsNumber ? comparatorMajor : comparatorMajor - 1,
        );
        break;
      case '<=':
        maxMajor = Math.min(maxMajor, comparatorMajor);
        break;
      case '~':
        // ~24 → >=24.0.0 <25.0.0；~24.18 → >=24.18.0 <24.19.0，均在主版本 24 内。
        minMajor = Math.max(minMajor, comparatorMajor);
        maxMajor = Math.min(maxMajor, comparatorMajor);
        break;
      case '^':
        minMajor = Math.max(minMajor, comparatorMajor);
        if (comparatorMajor > 0) maxMajor = Math.min(maxMajor, comparatorMajor);
        break;
      case '':
      case '=': {
        // 裸版本与 = 版本：带 minor/patch 是精确匹配，裸主版本（24、24.x）也限定在主版本内。
        minMajor = Math.max(minMajor, comparatorMajor);
        maxMajor = Math.min(maxMajor, comparatorMajor);
        break;
      }
      default:
        return false;
    }
  }
  if (!matched) return false;
  return minMajor === major && maxMajor === major;
}

function loadJson(relativePath) {
  const absolute = join(repoRoot, relativePath);
  if (!existsSync(absolute)) fail(`missing ${relativePath}`);
  return JSON.parse(readFileSync(absolute, 'utf8'));
}

const nvmrc = readFileSync(join(repoRoot, '.nvmrc'), 'utf8').trim();
const authorityMajor = leadingMajor(nvmrc);
if (authorityMajor === null) fail(`cannot parse .nvmrc: ${nvmrc}`);
const authorityVersionMatch = nvmrc.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
if (authorityVersionMatch === null)
  fail(`.nvmrc must pin an exact Node version: ${nvmrc}`);
const authorityVersion = authorityVersionMatch.slice(1).join('.');
const expectedEngineRange = `>=${authorityVersion}`;

// 展开 pnpm-workspace.yaml 的 packages glob（apps/*、packages/*）为具体包目录；
// tooling/ 等非 workspace 目录不在检查范围。
const workspaceYaml = readFileSync(
  join(repoRoot, 'pnpm-workspace.yaml'),
  'utf8',
);
const workspacePackages = [];
for (const line of workspaceYaml.split(/\r?\n/)) {
  const match = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
  if (match === null) continue;
  const glob = match[1];
  const star = glob.indexOf('/*');
  if (star === -1) continue; // 非目录通配 glob，不在本门禁范围
  const parent = glob.slice(0, star);
  if (!existsSync(join(repoRoot, parent))) continue;
  for (const entry of readdirSync(join(repoRoot, parent), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const packageJsonPath = join(parent, entry.name, 'package.json');
    if (existsSync(join(repoRoot, packageJsonPath)))
      workspacePackages.push(packageJsonPath);
  }
}

let driftCount = 0;
function report(ok, packageName, check, detail) {
  if (!ok) driftCount += 1;
  console.log(
    `[node-version-gate] ${ok ? 'ok  ' : 'FAIL'} ${packageName} ${check} ${detail}`,
  );
}

// 根 engines 与 workspace 一起统一（根没有 @types/node 声明）。
const rootPackage = loadJson('package.json');
const rootEngines = rootPackage.engines?.node;
if (rootEngines !== undefined) {
  const ok = rootEngines === expectedEngineRange;
  report(
    ok,
    '(root)',
    'engines.node',
    `${rootEngines} equals ${expectedEngineRange}? ${ok}`,
  );
}

for (const relativePath of workspacePackages.sort()) {
  const packageJson = loadJson(relativePath);
  const name = packageJson.name ?? relativePath;

  const typesRange = packageJson.devDependencies?.['@types/node'];
  if (typesRange !== undefined) {
    const ok = rangeStrictlyPinsMajor(typesRange, authorityMajor);
    report(
      ok,
      name,
      '@types/node',
      `${typesRange} pins major ${authorityMajor}? ${ok}`,
    );
  }

  const enginesRange = packageJson.engines?.node;
  if (enginesRange !== undefined) {
    const ok = enginesRange === expectedEngineRange;
    report(
      ok,
      name,
      'engines.node',
      `${enginesRange} equals ${expectedEngineRange}? ${ok}`,
    );
  }
}

if (driftCount > 0) {
  fail(
    `FAILED: ${driftCount} 处版本声明未与 Node ${authorityVersion} 最低基线保持一致`,
  );
}
console.log(
  `[node-version-gate] PASS: 全部 workspace 的 @types/node 对齐 Node ${authorityMajor}，engines 允许 Node ${authorityVersion} 及以上版本`,
);
