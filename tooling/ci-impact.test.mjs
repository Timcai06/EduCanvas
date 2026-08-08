import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyChangedPaths,
  comparisonRange,
  requiredResultFailures,
} from './quality/ci-impact.mjs';

describe('CI impact classification', () => {
  it('skips costly lanes for documentation and shared editor configuration', () => {
    assert.deepEqual(
      classifyChangedPaths(['docs/README.md', '.vscode/settings.json']),
      {
        checks: false,
        integration: false,
        windows: false,
        runtime_pressure: false,
        e2e: false,
        dependency_review: false,
      },
    );
  });

  it('runs governance checks for non-whitelisted VS Code state', () => {
    const result = classifyChangedPaths(['.vscode/launch.json']);
    assert.equal(result.checks, true);
    assert.equal(result.integration, false);
    assert.equal(result.e2e, false);
  });

  it('does not treat executable release evidence as documentation-only', () => {
    const result = classifyChangedPaths([
      'docs/06-quality/releases/rc1/manifest.json',
    ]);
    assert.equal(result.checks, true);
  });

  it('does not treat Markdown test fixtures as documentation-only', () => {
    const result = classifyChangedPaths(['tests/fixtures/sample.md']);
    assert.equal(result.checks, true);
  });

  it('runs all lanes for dependency, CI workflow, manual, or unknown changes', () => {
    assert.ok(
      Object.values(classifyChangedPaths(['pnpm-lock.yaml'])).every(Boolean),
    );
    assert.ok(
      Object.values(classifyChangedPaths(['.github/workflows/ci.yml'])).every(
        Boolean,
      ),
    );
    assert.ok(
      Object.values(
        classifyChangedPaths(['docs/a.md'], { eventName: 'workflow_dispatch' }),
      ).every(Boolean),
    );
    assert.ok(Object.values(classifyChangedPaths([])).every(Boolean));
    assert.ok(
      Object.values(classifyChangedPaths(['new-root/file.ts'])).every(Boolean),
    );
  });

  it('routes database changes without paying unrelated Windows or pressure costs', () => {
    assert.deepEqual(classifyChangedPaths(['packages/db/src/repository.ts']), {
      checks: true,
      integration: true,
      windows: false,
      runtime_pressure: false,
      e2e: true,
      dependency_review: false,
    });
  });

  it('routes Windows and runtime changes independently', () => {
    const result = classifyChangedPaths(['start-educanvas.ps1']);
    assert.equal(result.checks, true);
    assert.equal(result.windows, true);
    assert.equal(result.runtime_pressure, false);
    assert.equal(result.e2e, false);
  });

  it('keeps Web Runtime pressure and security-sensitive composition in the same gate set', () => {
    const result = classifyChangedPaths(['apps/web-runtime/src/server.ts']);
    assert.equal(result.checks, true);
    assert.equal(result.runtime_pressure, true);
    assert.equal(result.e2e, true);
  });

  it('compares pull requests from the merge base rather than base-branch churn', () => {
    const base = 'a'.repeat(40);
    const head = 'b'.repeat(40);
    assert.equal(comparisonRange(base, head), `${base}...${head}`);
    assert.throws(() => comparisonRange('invalid', head));
  });

  it('accepts intentionally skipped lanes but rejects failed required lanes', () => {
    const baseResults = {
      changes: 'success',
      secret_scan: 'success',
      dependency_review: 'skipped',
      quality: 'skipped',
      integration: 'skipped',
      windows: 'skipped',
      runtime_pressure: 'skipped',
      e2e: 'skipped',
      release_evidence: 'skipped',
    };
    assert.deepEqual(
      requiredResultFailures({
        eventName: 'pull_request',
        expected: classifyChangedPaths(['docs/README.md']),
        results: baseResults,
      }),
      [],
    );
    assert.deepEqual(
      requiredResultFailures({
        eventName: 'pull_request',
        expected: classifyChangedPaths(['pnpm-lock.yaml']),
        results: {
          ...baseResults,
          quality: 'success',
          integration: 'success',
          windows: 'success',
          runtime_pressure: 'success',
          e2e: 'failure',
          release_evidence: 'success',
        },
      }),
      [
        'e2e was required but concluded: failure',
        'dependency_review was required but concluded: skipped',
      ],
    );
  });
});
