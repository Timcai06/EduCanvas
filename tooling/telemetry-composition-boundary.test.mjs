import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

const roots = ['apps', 'packages'];
const allowedFrameworkRoot = 'packages/telemetry/';
const compositionFiles = [
  'apps/gateway/src/agent-runner.ts',
  'apps/web/server/platform/general-turn.ts',
  'apps/web/server/teaching/learning-turn.ts',
];

function posixRelative(path) {
  return relative(process.cwd(), path).replaceAll('\\', '/');
}

function productionTypescriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypescriptFiles(path);
    return entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.includes('.test')
      ? [path]
      : [];
  });
}

describe('Telemetry production boundary', () => {
  it('isolates OpenTelemetry framework imports in the telemetry adapter package', () => {
    const violations = roots
      .flatMap(productionTypescriptFiles)
      .filter((path) => readFileSync(path, 'utf8').includes('@opentelemetry/'))
      .map(posixRelative)
      .filter((path) => !path.startsWith(allowedFrameworkRoot));
    assert.deepEqual(violations, []);
  });

  it('injects one stable trace port into all production Turn compositions', () => {
    for (const path of compositionFiles) {
      const source = readFileSync(path, 'utf8');
      assert.match(
        source,
        /trace: get(?:Gateway|Web)TelemetryRuntime\(\)\.turnTrace/,
      );
      assert.doesNotMatch(source, /@opentelemetry\//);
    }
  });
});
