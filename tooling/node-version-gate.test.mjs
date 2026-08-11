import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';

// 门禁测试用隔离的临时 fixture 仓库，不依赖真实仓库当前状态，
// 这样既能证明“拒绝 Node 26 types 漂移 / 拒绝宽泛 engines 范围”的失败路径，
// 也能覆盖未来的回归。策略：Node 24 是唯一主版本，engines 与 @types/node
// 中：engines 必须统一为 >=24.18.0 <25，@types/node 必须限定在 24 主版本。
const temporaryDirectories = [];

function runGate(repoRoot) {
  return spawnSync(
    process.execPath,
    ['tooling/node-version-gate.mjs', repoRoot],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );
}

async function writeFixture(packages = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'educanvas-node-gate-'));
  temporaryDirectories.push(root);
  await writeFile(path.join(root, '.nvmrc'), '24.18.0\n', 'utf8');
  await writeFile(
    path.join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - apps/*\n  - packages/*\n',
    'utf8',
  );
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify(
      { name: 'fixture-root', engines: { node: '>=24.18.0 <25' } },
      null,
      2,
    ),
    'utf8',
  );
  // 非 workspace 目录（对应 tooling/voice-lab 一类）不应参与检查
  await mkdir(path.join(root, 'tooling', 'voice-lab'), { recursive: true });
  await writeFile(
    path.join(root, 'tooling', 'voice-lab', 'package.json'),
    JSON.stringify(
      { name: '@educanvas/voice-lab', engines: { node: '>=22.6' } },
      null,
      2,
    ),
    'utf8',
  );
  for (const [relative, pkg] of Object.entries(packages)) {
    const directory = path.join(root, relative);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify(pkg, null, 2),
      'utf8',
    );
  }
  return root;
}

function packageAt(name, extras = {}) {
  return {
    name,
    version: '0.1.0',
    private: true,
    engines: { node: '>=24.18.0 <25' },
    devDependencies: { '@types/node': '^24.13.3' },
    ...extras,
  };
}

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('node-version-gate', () => {
  it('accepts the exact engine baseline derived from .nvmrc', async () => {
    const root = await writeFixture({
      'apps/a': packageAt('@educanvas/a'),
      'packages/b': packageAt('@educanvas/b'),
      'packages/c': packageAt('@educanvas/c', {
        engines: { node: '>=24.18.0 <25' },
        devDependencies: { '@types/node': '>=24 <25' },
      }),
      'packages/d': packageAt('@educanvas/d'),
    });
    const result = runGate(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS/);
    assert.match(result.stdout, /Node 24/);
  });

  it('rejects @types/node that drifted to Node 26 types', async () => {
    const root = await writeFixture({
      'apps/a': packageAt('@educanvas/a'),
      'packages/b': packageAt('@educanvas/b', {
        devDependencies: { '@types/node': '^26.1.1' },
      }),
    });
    const result = runGate(root);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL @educanvas\/b @types\/node/);
    assert.match(result.stderr, /FAILED/);
  });

  it('rejects @types/node declared with a loose lower bound', async () => {
    // >=24 允许解析到 Node 26 types，必须与宽泛 engines 一样拒绝。
    const root = await writeFixture({
      'packages/c': packageAt('@educanvas/c', {
        devDependencies: { '@types/node': '>=24' },
      }),
    });
    const result = runGate(root);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL @educanvas\/c @types\/node/);
  });

  it('rejects engines that allow a higher Node major', async () => {
    const cases = [
      { engines: { node: '>=24' } }, // 只写下限，允许 25/26 运行时漂移
      { engines: { node: '>=26' } },
      { engines: { node: '>=24.18' } },
      { engines: { node: '>=24 <27' } },
    ];
    for (const [index, extras] of cases.entries()) {
      const root = await writeFixture({
        [`packages/higher-${index}`]: packageAt(
          `@educanvas/higher-${index}`,
          extras,
        ),
      });
      const result = runGate(root);
      assert.equal(
        result.status,
        1,
        `engines ${JSON.stringify(extras)} should fail`,
      );
      assert.match(result.stdout, /FAIL .* engines\.node/);
    }
  });

  it('rejects same-major engines below the exact repository baseline', async () => {
    const cases = [
      { engines: { node: '^24' } },
      { engines: { node: '>=24.0.0 <25' } },
      { engines: { node: '~24.18.0' } },
    ];
    for (const [index, extras] of cases.entries()) {
      const root = await writeFixture({
        [`packages/lower-24-${index}`]: packageAt(
          `@educanvas/lower-24-${index}`,
          extras,
        ),
      });
      const result = runGate(root);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /FAIL .* engines\.node/);
    }
  });

  it('rejects engines with a lower floor or wildcard', async () => {
    const cases = [
      { engines: { node: '>=22 <25' } }, // 下限低于唯一主版本
      { engines: { node: '*' } },
      { engines: { node: '>=18 <23' } }, // 完全不包含 24
    ];
    for (const [index, extras] of cases.entries()) {
      const root = await writeFixture({
        [`packages/floor-${index}`]: packageAt(
          `@educanvas/floor-${index}`,
          extras,
        ),
      });
      const result = runGate(root);
      assert.equal(
        result.status,
        1,
        `engines ${JSON.stringify(extras)} should fail`,
      );
      assert.match(result.stdout, /FAIL .* engines\.node/);
    }
  });

  it('ignores non-workspace tooling packages', async () => {
    const root = await writeFixture();
    const result = runGate(root);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /voice-lab/);
  });

  it('passes on the real repository (checked by test:tooling in CI)', () => {
    // 防止 fixture 全绿但真实仓库漂移：本地/CI 跑 test:tooling 时直接验证仓库根。
    const result = spawnSync(
      process.execPath,
      ['tooling/node-version-gate.mjs'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
  });
});
