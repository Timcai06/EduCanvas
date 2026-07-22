import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, it } from 'node:test';

const sourceRoot = 'packages/mcp-runtime/src';
const productionFiles = readdirSync(sourceRoot)
  .filter(
    (name) =>
      name.endsWith('.ts') &&
      !name.includes('.test.') &&
      name !== 'test-support.ts',
  )
  .map((name) => join(sourceRoot, name));
const reviewableAdapterFiles = [
  ...readdirSync('apps/worker/src/mcp')
    .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
    .map((name) => join('apps/worker/src/mcp', name)),
  ...readdirSync('packages/db/src')
    .filter(
      (name) =>
        name.startsWith('mcp-') &&
        name.endsWith('.ts') &&
        !name.includes('.test.'),
    )
    .map((name) => join('packages/db/src', name)),
  'packages/db/src/schema/mcp-intent.ts',
];

describe('MCP Runtime architecture boundary', () => {
  it('keeps protocol SDK isolated from Hybrid Ports and forbidden hosts', () => {
    for (const path of productionFiles) {
      const source = readFileSync(path, 'utf8');
      const educanvasImports = [
        ...source.matchAll(/from ['"](@educanvas\/[^'"]+)['"]/g),
      ].map((match) => match[1]);
      assert.deepEqual(
        [...new Set(educanvasImports)].filter(
          (specifier) =>
            !['@educanvas/agent-core', '@educanvas/agent-runtime'].includes(
              specifier,
            ),
        ),
        [],
        path,
      );
      assert.doesNotMatch(
        source,
        /node:(?:child_process|fs)|stdio|spawn\s*\(/,
        path,
      );
      if (source.includes('@modelcontextprotocol/sdk')) {
        assert.equal(basename(path), 'streamable-http-session.ts');
      }
    }
  });

  it('keeps every MCP production module reviewable', () => {
    for (const path of productionFiles) {
      const lines = readFileSync(path, 'utf8').split('\n').length;
      assert.ok(lines <= 250, `${path} has ${lines} lines`);
    }
    for (const path of reviewableAdapterFiles) {
      const lines = readFileSync(path, 'utf8').split('\n').length;
      assert.ok(lines <= 400, `${path} has ${lines} lines`);
    }
  });
});
