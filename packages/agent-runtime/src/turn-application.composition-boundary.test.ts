/**
 * Turn Application 唯一组合工厂静态门禁（R 线 R06）。
 *
 * 目标：三条生产路径统一经 `createTurnApplication` 组装；生产代码不得再直接
 * `new TurnApplicationService`，唯一例外是 factory.ts 本身。测试文件不受限。
 * 本测试以 R06 台账为基线，拒绝"新增"违约引用。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

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
  /\.(test|spec)\.(ts|tsx|mjs|js)$|(?:integration[-.]support|integration[-.]fixture|fixture)\.ts$/;

// R06 台账：唯一允许直接 new TurnApplicationService 的生产文件。
const ALLOWED_NEW_TURN_APPLICATION =
  'packages/agent-runtime/src/turn-application/factory.ts';

// R06 收口：允许直接实例化 Drizzle 公共账本与 ToolKernel 的组合模块。
const ALLOWED_DRIZZLE_TOOLKERNEL_CONSTRUCTION = new Set([
  'apps/web/server/turn-composition.ts',
  'apps/gateway/src/turn-composition.ts',
  'apps/web/server/platform/general-turn-tools.ts',
]);

// 三条生产入口必须经共享组合层装配，不得各自复制公共依赖构造。
const ENTRY_POINTS = [
  'apps/web/server/platform/general-turn.ts',
  'apps/web/server/teaching/learning-turn.ts',
  'apps/gateway/src/agent-runner.ts',
];

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

function isTestFile(file: string): boolean {
  const rel = relative(ROOT, file);
  return (
    TEST_FILE_RE.test(rel) ||
    rel.startsWith('tests/e2e') ||
    rel.includes('integration.support') ||
    rel.includes('integration-fixture')
  );
}

describe('Turn Application 唯一组合工厂（R06）', () => {
  const files = walkFiles();

  it('生产代码不得直接 new TurnApplicationService（仅 factory.ts 例外）', () => {
    const violations: string[] = [];
    for (const file of files) {
      if (isTestFile(file)) continue;
      const rel = relative(ROOT, file);
      if (rel === ALLOWED_NEW_TURN_APPLICATION) continue;
      const src = readFileSync(file, 'utf8');
      if (src.includes('new TurnApplicationService(')) violations.push(rel);
    }
    expect(violations).toEqual([]);
  });

  it('三条生产入口统一经 createTurnApplication 或 createGatewayTurnApplication 组装', () => {
    for (const entry of ENTRY_POINTS) {
      const src = readFileSync(join(ROOT, entry), 'utf8');
      expect(src).not.toContain('new TurnApplicationService(');
      // Gateway 入口经 createGatewayTurnApplication（内部调用 createTurnApplication）
      if (entry === 'apps/gateway/src/agent-runner.ts') {
        expect(src).toContain('createGatewayTurnApplication(');
      } else {
        // Web 入口经 createWebTurnApplication 组合根（R06 引入 turn-composition 后收口）
        expect(src).toContain('createWebTurnApplication(');
      }
    }
    // 组合根仍必须经唯一工厂 createTurnApplication 组装，避免入口绕过门禁。
    for (const composition of [
      'apps/web/server/turn-composition.ts',
      'apps/gateway/src/turn-composition.ts',
    ]) {
      const src = readFileSync(join(ROOT, composition), 'utf8');
      expect(src).toContain('createTurnApplication(');
    }
  });

  it('门禁自检：factory.ts 本身包含唯一构造调用', () => {
    const factory = readFileSync(
      join(ROOT, ALLOWED_NEW_TURN_APPLICATION),
      'utf8',
    );
    expect(factory).toContain('new TurnApplicationService(');
  });

  // R06 收口：三条入口不得各自复制公共 Drizzle 账本与 ToolKernel 构造。
  it('三条入口不得各自 new DrizzleAgentTurnContextRepository', () => {
    const violations: string[] = [];
    for (const file of files) {
      if (isTestFile(file)) continue;
      const rel = relative(ROOT, file);
      if (ALLOWED_DRIZZLE_TOOLKERNEL_CONSTRUCTION.has(rel)) continue;
      const src = readFileSync(file, 'utf8');
      if (src.includes('new DrizzleAgentTurnContextRepository('))
        violations.push(rel);
    }
    expect(violations).toEqual([]);
  });

  it('三条入口不得各自 new DrizzleAgentModelRunRepository', () => {
    const violations: string[] = [];
    for (const file of files) {
      if (isTestFile(file)) continue;
      const rel = relative(ROOT, file);
      if (ALLOWED_DRIZZLE_TOOLKERNEL_CONSTRUCTION.has(rel)) continue;
      const src = readFileSync(file, 'utf8');
      if (src.includes('new DrizzleAgentModelRunRepository('))
        violations.push(rel);
    }
    expect(violations).toEqual([]);
  });

  it('三条入口不得各自 new ToolKernel（应经 Web/Gateway 组合模块）', () => {
    const violations: string[] = [];
    for (const file of files) {
      if (isTestFile(file)) continue;
      const rel = relative(ROOT, file);
      if (ALLOWED_DRIZZLE_TOOLKERNEL_CONSTRUCTION.has(rel)) continue;
      const src = readFileSync(file, 'utf8');
      if (src.includes('new ToolKernel(')) violations.push(rel);
    }
    expect(violations).toEqual([]);
  });

  it('Web 两条入口导入共享组合模块 turn-composition', () => {
    for (const entry of [
      'apps/web/server/platform/general-turn.ts',
      'apps/web/server/teaching/learning-turn.ts',
    ]) {
      const src = readFileSync(join(ROOT, entry), 'utf8');
      expect(src).toContain("from '../turn-composition'");
    }
  });

  it('门禁自检：turn-composition.ts 本身包含 ToolKernel 与 Drizzle Agent Repository 构造', () => {
    const src = readFileSync(
      join(ROOT, 'apps/web/server/turn-composition.ts'),
      'utf8',
    );
    expect(src).toContain('new ToolKernel(');
    expect(src).toContain('new DrizzleAgentTurnContextRepository(');
    expect(src).toContain('new DrizzleAgentModelRunRepository(');
  });
});
