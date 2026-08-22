/**
 * @educanvas/db 公共出口收口的静态边界门禁（R 线 R04）。
 *
 * 目标：默认入口只保留稳定 Repository / Port Adapter / 公开类型；schema 表与 getDb
 * 只允许经 `@educanvas/db/internal` / `@educanvas/db/testing` 使用；生产代码不得绕过
 * 包入口直接引用 db 内部文件。本测试以 R04 台账盘点的全仓引用为基线，拒绝"新增"
 * 违约依赖，允许既有引用随 R05/R06 迁移逐步减少。
 *
 * tooling/ 自 Q01 回退后纳入扫描范围：评测/工具 harness 曾深度导入 db 内部源码绕过
 * 包导出边界，该盲区随 Q01 revert 关闭（见 #293），此处补门禁防同类问题复现。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

/* 台账基线统一用 / 分隔：Windows 上 relative() 产生 \，直接比对会全部"新增"。 */
const norm = (path: string) => path.split(sep).join('/');
import { describe, expect, it } from 'vitest';

// 端到端验证受控 subpath 可解析（vitest 按 package.json exports 解析）。
import {
  getDb as internalGetDb,
  agentOperations,
} from '@educanvas/db/internal';
import {
  getDb as testingGetDb,
  spaces as testingSpaces,
} from '@educanvas/db/testing';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SOURCE_ROOTS = ['apps', 'packages', 'tests', 'tooling'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  '.turbo',
  '.git',
  'coverage',
]);
const TEST_FILE_RE =
  /\.(test|spec)\.(ts|tsx|mjs|js)$|(?:integration-support|fixture)\.ts$/;

// R08 收口：只有这些服务端组合点可以经 internal subpath 获取底层连接。
// 默认入口不再导出 getDb；allowlist 允许后续继续减量，拒绝新增。
const INTERNAL_GET_DB_PRODUCTION_ALLOWLIST = new Set([
  'apps/gateway/src/canvas-resource-service.ts',
  'apps/gateway/src/index.ts',
  'apps/telegram/src/index.ts',
  'apps/web/app/api/v1/chat/artifacts/[artifactId]/download/route.ts',
  'apps/web/app/api/v1/chat/artifacts/[artifactId]/route.ts',
  'apps/web/server/canvas/resource-access.ts',
  'apps/web/server/study/study-service.ts',
  'apps/web/server/teaching/knowledge-retrieval-runtime.ts',
  'apps/web/server/teaching/learning-session.ts',
  'apps/web/server/teaching/teaching-tools.ts',
]);

// RM01 的统一资源摘要只向 Web BFF 暴露两项窄读模型实现；它不提供连接、schema
// 或写仓库能力。新增消费者或符号必须显式经过本门禁复核。
const WORKSPACE_RESOURCE_SUMMARY_PRODUCTION_ALLOWLIST = new Map([
  [
    'apps/web/server/canvas/workspace-resource-read-model.ts',
    new Set([
      'DrizzleWorkspaceResourceMemberFactsRepository',
      'DrizzleWorkspaceResourceSummaryRepository',
    ]),
  ],
]);

// DP10：共享对象存储经专用 subpath 只向 web/gateway 服务端暴露；web 原
// asset-storage.ts 已降级为 thin re-export shim（保留 server-only）。新增消费者
// 或符号必须显式经过本门禁复核。
const ASSET_OBJECT_STORAGE_PRODUCTION_ALLOWLIST = new Map([
  [
    'apps/web/server/assets/asset-storage.ts',
    new Set([
      'readStoredAssetBytes',
      'removeStoredAsset',
      'removeStoredAssetByKey',
      'storeAssetBytes',
      'StoredAssetObject',
    ]),
  ],
]);

// R04 台账 R04.2：默认入口按需保留的 schema 表（曾经 export * 全量泄漏）。生产引用基线为 0。
const SCHEMA_TABLE_DENYLIST = new Set([
  'agentOperations',
  'artifactVersions',
  'assets',
  'assetVersions',
  'audioConsents',
  'audioRetentions',
  'conversations',
  'gatewayApprovals',
  'gatewayOperationEvents',
  'mcpToolIntents',
  'notebookMemberships',
  'objectDeletionOutbox',
  'operationContinuations',
  'platformUsers',
  'securityAuditEvents',
  'spaces',
  'toolApprovalIntents',
]);

// R05 台账 R05.2/R05.3：旧写入者生产引用基线（2026-08-06 盘点）。
// DrizzleModelRunRepository 唯一生产引用是 audited-model-gateway.ts（死代码，R08 删除）；
// DrizzleToolCallRepository 生产基线为 0。
const LEGACY_WRITER_PRODUCTION_BASELINE = new Set([
  'apps/web/server/model/audited-model-gateway.ts',
]);
const LEGACY_WRITER_SYMBOLS = new Set([
  'DrizzleModelRunRepository',
  'DrizzleToolCallRepository',
]);

interface DbImport {
  file: string;
  isTest: boolean;
  /** 导入形态：静态 import/export、动态 import()、vi.mock 工厂路径。 */
  kind: 'static' | 'dynamic' | 'vi.mock';
  specifier: string;
  subpath: string;
  symbols: string[];
}

function walkFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|mjs|js|jsx)$/.test(entry.name)) files.push(path);
    }
  };
  for (const root of SOURCE_ROOTS) {
    const dir = join(ROOT, root);
    if (statSync(dir, { throwIfNoEntry: false })) walk(dir);
  }
  return files;
}

function collectDbImports(files: string[]): DbImport[] {
  const result: DbImport[] = [];
  const staticRe =
    /(?:import|export)\s+(?:type\s+)?\s*(\{[^}]*\}|[\w$]+|\*\s+as\s+[\w$]+)\s+from\s+['"]@educanvas\/db([^'"]*)['"]/g;
  const dynamicRe = /import\s*\(\s*['"]@educanvas\/db([^'"]*)['"]\s*\)/g;
  const viMockRe = /vi\.mock\s*\(\s*['"]@educanvas\/db([^'"]*)['"]/g;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const isTest = isTestFile(file);
    const register = (
      specifier: string,
      subpath: string,
      symbols: string[],
      kind: DbImport['kind'],
    ): void => {
      result.push({
        file: norm(relative(ROOT, file)),
        isTest,
        kind,
        specifier,
        subpath,
        symbols,
      });
    };
    let m: RegExpExecArray | null;
    while ((m = staticRe.exec(src)) !== null) {
      const spec = m[1]!.trim();
      const isNamespace = spec.startsWith('*');
      const symbols = isNamespace
        ? ['*']
        : spec.startsWith('{')
          ? spec
              .slice(1, -1)
              .split(',')
              .map((s) =>
                s
                  .trim()
                  .split(/\s+as\s+/)[0]!
                  .replace(/^type\s+/, '')
                  .trim(),
              )
              .filter(Boolean)
          : [spec];
      register(`@educanvas/db${m[2]!}`, m[2]!, symbols, 'static');
    }
    while ((m = dynamicRe.exec(src)) !== null) {
      register(`@educanvas/db${m[1]!}`, m[1]!, [], 'dynamic');
    }
    while ((m = viMockRe.exec(src)) !== null) {
      register(`vi.mock('@educanvas/db${m[1]!}')`, m[1]!, [], 'vi.mock');
    }
  }
  return result;
}

// 生产代码绕过包入口、以文件路径直接引用 packages/db/src 内部实现的导入。
// 豁免范围：tests/e2e 端到端测试层（需要真实仓库内部访问，刻意豁免）；
// 其余包外文件无论是否测试/工具（apps、tooling）都禁止深度导入——Q01 评测
// harness 曾借测试文件豁免深度导入 src 绕过 R04 边界（#293 revert 原因之一），
// 2026-08-07 收紧：包外测试应走 @educanvas/db/testing 受控入口。
function collectRawDbPathImports(files: string[]): string[] {
  const result: string[] = [];
  const staticRe = /from\s+['"]([^'"]*packages\/db\/src[^'"]*)['"]/g;
  const dynamicRe =
    /import\s*\(\s*['"]([^'"]*packages\/db\/src[^'"]*)['"]\s*\)/g;
  for (const file of files) {
    if (file.startsWith(join(ROOT, 'packages/db'))) continue;
    /* 豁免判断同样用 norm() 归一化：Windows 上 relative() 返回 \ 分隔路径，
       直接 startsWith('tests/e2e') 会漏过豁免。 */
    if (norm(relative(ROOT, file)).startsWith('tests/e2e')) continue;
    const src = readFileSync(file, 'utf8');
    for (const re of [staticRe, dynamicRe]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        result.push(`${norm(relative(ROOT, file))} -> ${m[1]}`);
      }
    }
  }
  return result;
}

function isTestFile(file: string): boolean {
  const rel = relative(ROOT, file);
  return TEST_FILE_RE.test(rel) || rel.startsWith('tests/e2e');
}

describe('@educanvas/db 公共出口收口（R04）', () => {
  const files = walkFiles();
  const dbImports = collectDbImports(files);
  const prodImports = dbImports.filter((i) => !i.isTest);
  const pkgJson = JSON.parse(
    readFileSync(join(ROOT, 'packages/db/package.json'), 'utf8'),
  ) as { exports?: Record<string, string> };

  it('package.json exports 只暴露受控入口', () => {
    expect(Object.keys(pkgJson.exports ?? {})).toEqual([
      '.',
      './asset-object-storage',
      './internal',
      './workspace-resource-summary',
      './testing',
      './package.json',
    ]);
    for (const [key, target] of Object.entries(pkgJson.exports!)) {
      if (key === './package.json') continue;
      expect(
        statSync(join(ROOT, 'packages/db', target), { throwIfNoEntry: false }),
        key,
      ).toBeTruthy();
    }
  });

  it('默认入口不再全量泄漏 schema（无 export * 指向 ./schema 或 ./schema/study）', () => {
    const indexSrc = readFileSync(
      join(ROOT, 'packages/db/src/index.ts'),
      'utf8',
    );
    expect(indexSrc).not.toMatch(
      /export\s+\*\s+from\s+['"]\.\/schema(?:['"]|\/study['"])/,
    );
  });

  it('生产 subpath 仅允许获准组合点从 internal 导入 getDb', () => {
    const violations = prodImports.filter((i) => {
      if (i.subpath === '') return false;
      if (i.subpath === '/workspace-resource-summary') {
        const allowed = WORKSPACE_RESOURCE_SUMMARY_PRODUCTION_ALLOWLIST.get(
          i.file,
        );
        return (
          !allowed ||
          i.symbols.length !== allowed.size ||
          i.symbols.some((symbol) => !allowed.has(symbol))
        );
      }
      if (i.subpath === '/asset-object-storage') {
        const allowed = ASSET_OBJECT_STORAGE_PRODUCTION_ALLOWLIST.get(i.file);
        return (
          !allowed ||
          i.symbols.length !== allowed.size ||
          i.symbols.some((symbol) => !allowed.has(symbol))
        );
      }
      return !(
        i.subpath === '/internal' &&
        i.symbols.length === 1 &&
        i.symbols[0] === 'getDb' &&
        INTERNAL_GET_DB_PRODUCTION_ALLOWLIST.has(i.file)
      );
    });
    expect(violations.map((v) => `${v.file}: ${v.specifier}`)).toEqual([]);
  });

  it('测试代码也不允许直接导入 @educanvas/db/schema（应经 internal/testing）', () => {
    const violations = dbImports.filter((i) => i.subpath.startsWith('/schema'));
    expect(violations.map((v) => `${v.file}: ${v.specifier}`)).toEqual([]);
  });

  it('默认入口不导出 getDb，生产调用仅存在于 internal allowlist', () => {
    const indexSrc = readFileSync(
      join(ROOT, 'packages/db/src/index.ts'),
      'utf8',
    );
    expect(indexSrc).not.toMatch(/export\s*\{[^}]*\bgetDb\b[^}]*\}/s);

    const defaultImports = prodImports.filter(
      (i) => i.subpath === '' && i.symbols.includes('getDb'),
    );
    expect(defaultImports.map((i) => i.file)).toEqual([]);

    const internalFiles = prodImports
      .filter((i) => i.subpath === '/internal' && i.symbols.includes('getDb'))
      .map((i) => i.file);
    expect(
      internalFiles.filter(
        (file) => !INTERNAL_GET_DB_PRODUCTION_ALLOWLIST.has(file),
      ),
    ).toEqual([]);
  });

  it('生产代码不新增 schema 表符号依赖（denylist 17 表，基线 0）', () => {
    const violations = prodImports.filter((i) =>
      i.symbols.some((s) => SCHEMA_TABLE_DENYLIST.has(s)),
    );
    expect(violations.map((v) => `${v.file}: ${v.symbols.join(', ')}`)).toEqual(
      [],
    );
  });

  it('生产代码不新增旧写入者依赖（R05 单轨收口：DrizzleModelRunRepository / DrizzleToolCallRepository）', () => {
    const violations = prodImports
      .filter((i) => i.symbols.some((s) => LEGACY_WRITER_SYMBOLS.has(s)))
      .filter((i) => !LEGACY_WRITER_PRODUCTION_BASELINE.has(i.file));
    expect(violations.map((v) => `${v.file}: ${v.symbols.join(', ')}`)).toEqual(
      [],
    );
  });

  it('生产代码不得直写 turn_context_snapshots（R05：必须经 DrizzleAgentTurnContextRepository）', () => {
    const violations = prodImports.filter((i) =>
      i.symbols.includes('turnContextSnapshots'),
    );
    expect(violations.map((v) => `${v.file}: ${v.symbols.join(', ')}`)).toEqual(
      [],
    );
  });

  it('生产代码不得用 namespace 导入（import * as）绕过符号级门禁', () => {
    const violations = prodImports.filter((i) => i.symbols.includes('*'));
    expect(violations.map((v) => `${v.file}: ${v.specifier}`)).toEqual([]);
  });

  it('生产代码禁止动态 import / vi.mock @educanvas/db（可绕过符号 denylist）', () => {
    const violations = prodImports.filter((i) => i.kind !== 'static');
    expect(violations.map((v) => `${v.file}: ${v.specifier}`)).toEqual([]);
  });

  it('生产代码不得绕过包入口直接引用 packages/db/src 内部文件', () => {
    expect(collectRawDbPathImports(files)).toEqual([]);
  });

  it('internal/testing subpath 端到端可用且语义正确', () => {
    const tableName = (table: object): string =>
      (table as Record<PropertyKey, unknown>)[
        Symbol.for('drizzle:Name')
      ] as string;
    expect(typeof internalGetDb).toBe('function');
    expect(typeof testingGetDb).toBe('function');
    expect(tableName(agentOperations)).toBe('agent_operations');
    expect(tableName(testingSpaces)).toBe('spaces');
  });

  it('扫描器自检：确实采集到默认入口导入，防止规则失效', () => {
    expect(dbImports.filter((i) => i.subpath === '').length).toBeGreaterThan(
      50,
    );
    expect(
      prodImports.some((i) => i.symbols.includes('DrizzleAssetRepository')),
    ).toBe(true);
  });
});
