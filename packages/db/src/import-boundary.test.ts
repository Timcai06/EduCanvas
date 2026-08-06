/**
 * @educanvas/db 公共出口收口的静态边界门禁（R 线 R04）。
 *
 * 目标：默认入口只保留稳定 Repository / Port Adapter / 公开类型；schema 表与 getDb
 * 只允许经 `@educanvas/db/internal` / `@educanvas/db/testing` 使用；生产代码不得绕过
 * 包入口直接引用 db 内部文件。本测试以 R04 台账盘点的全仓引用为基线，拒绝"新增"
 * 违约依赖，允许既有引用随 R05/R06 迁移逐步减少。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
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
const SOURCE_ROOTS = ['apps', 'packages', 'tests'];
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
        file: relative(ROOT, file),
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
function collectRawDbPathImports(files: string[]): string[] {
  const result: string[] = [];
  const staticRe = /from\s+['"]([^'"]*packages\/db\/src[^'"]*)['"]/g;
  const dynamicRe =
    /import\s*\(\s*['"]([^'"]*packages\/db\/src[^'"]*)['"]\s*\)/g;
  for (const file of files) {
    if (isTestFile(file)) continue;
    const src = readFileSync(file, 'utf8');
    for (const re of [staticRe, dynamicRe]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        result.push(`${relative(ROOT, file)} -> ${m[1]}`);
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
      './internal',
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
