import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

const roots = ['apps', 'packages'];
const ignoredDirectories = new Set(['.next', 'dist', 'node_modules']);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : sourceFiles(path);
    }
    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || entry.name.includes('.test.')) {
      return [];
    }
    return [path];
  });
}

function constructionFiles(className) {
  const pattern = new RegExp(`new\\s+${className}\\s*\\(`, 'g');
  return roots
    .flatMap(sourceFiles)
    .flatMap((path) => {
      const count = [...readFileSync(path, 'utf8').matchAll(pattern)].length;
      return Array.from({ length: count }, () => relative(process.cwd(), path));
    })
    .sort();
}

describe('Turn composition production boundary', () => {
  it('freezes the target service and remaining legacy construction points', () => {
    assert.deepEqual(constructionFiles('AgentLoopEngine'), [
      'apps/web/server/platform/general-turn.ts',
      'packages/agent-runtime/src/turn-application.ts',
      'packages/teaching-runtime/src/turn-orchestrator.ts',
    ]);
  });

  it('does not allow a third tool runtime or new entrypoint-local construction', () => {
    assert.deepEqual(constructionFiles('AgentToolRegistry'), [
      'apps/web/server/platform/general-turn.ts',
    ]);
    assert.deepEqual(constructionFiles('TeachingToolExecutor'), [
      'apps/web/server/teaching/teaching-tools.ts',
    ]);
  });
});
