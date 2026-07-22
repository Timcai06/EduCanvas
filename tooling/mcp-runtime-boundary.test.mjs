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

describe('MCP Runtime architecture boundary', () => {
  it('keeps protocol SDK isolated from Hybrid Ports and forbidden hosts', () => {
    for (const path of productionFiles) {
      const source = readFileSync(path, 'utf8');
      const educanvasImports = [
        ...source.matchAll(/from ['"](@educanvas\/[^'"]+)['"]/g),
      ].map((match) => match[1]);
      assert.deepEqual(
        [...new Set(educanvasImports)].filter(
          (specifier) => specifier !== '@educanvas/agent-runtime',
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
  });
});
