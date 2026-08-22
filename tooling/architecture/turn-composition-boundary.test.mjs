import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

const roots = ['apps', 'packages'];
const ignoredDirectories = new Set(['.next', 'dist', 'node_modules']);

function posixRelative(path) {
  return relative(process.cwd(), path).replaceAll('\\', '/');
}

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
      return Array.from({ length: count }, () => posixRelative(path));
    })
    .sort();
}

function declarationFiles(className) {
  const pattern = new RegExp(`(?:export\\s+)?class\\s+${className}\\b`, 'g');
  return roots
    .flatMap(sourceFiles)
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map(posixRelative)
    .sort();
}

function providerSdkImportFiles() {
  const pattern =
    /from\s+['"](?:ai(?:\/[^'"]*)?|@ai-sdk\/[^'"]+|openai|anthropic)['"]/;
  return roots
    .flatMap(sourceFiles)
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map(posixRelative)
    .sort();
}

export function containsSecondModelToolLoop(source) {
  return /\.stream\s*\([\s\S]{0,5000}?\.execute\s*\([\s\S]{0,5000}?\.stream\s*\(/.test(
    source,
  );
}

describe('Turn composition production boundary', () => {
  it('allows exactly one AgentLoopEngine construction point', () => {
    assert.deepEqual(declarationFiles('AgentLoopEngine'), [
      'packages/agent-runtime/src/agent-loop.ts',
    ]);
    assert.deepEqual(constructionFiles('AgentLoopEngine'), [
      'packages/agent-runtime/src/turn-application/loop-runner.ts',
    ]);
  });

  it('keeps Provider SDK imports inside model-gateway', () => {
    assert.ok(
      providerSdkImportFiles().every((path) =>
        path.startsWith('packages/model-gateway/'),
      ),
    );
  });

  it('rejects a second model-tool-model loop outside agent-runtime', () => {
    assert.equal(
      containsSecondModelToolLoop(
        'model.stream(input); tools.execute(call); model.stream(result);',
      ),
      true,
    );
    const offenders = roots
      .flatMap(sourceFiles)
      .filter(
        (path) => !posixRelative(path).startsWith('packages/agent-runtime/'),
      )
      .filter((path) => containsSecondModelToolLoop(readFileSync(path, 'utf8')))
      .map(posixRelative);
    assert.deepEqual(offenders, []);
  });

  it('does not allow legacy tool runtimes to return', () => {
    assert.deepEqual(constructionFiles('AgentToolRegistry'), []);
    assert.deepEqual(constructionFiles('TeachingToolExecutor'), []);
    assert.deepEqual(constructionFiles('TeachingTurnOrchestrator'), []);
  });
});
