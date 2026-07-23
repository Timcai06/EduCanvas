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
  it('allows exactly one AgentLoopEngine construction point', () => {
    assert.deepEqual(constructionFiles('AgentLoopEngine'), [
      'packages/agent-runtime/src/turn-application/loop-runner.ts',
    ]);
  });

  it('does not allow legacy tool runtimes to return', () => {
    assert.deepEqual(constructionFiles('AgentToolRegistry'), []);
    assert.deepEqual(constructionFiles('TeachingToolExecutor'), []);
    assert.deepEqual(constructionFiles('TeachingTurnOrchestrator'), []);
  });
});
