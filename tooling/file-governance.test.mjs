import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  auditTrackedFiles,
  classifyTrackedPath,
  largeSourceBaselineViolations,
  pathViolations,
} from './quality/file-governance.mjs';

describe('repository file governance', () => {
  it('classifies files on all four governance axes', () => {
    assert.deepEqual(classifyTrackedPath('packages/db/src/schema.ts'), {
      path: 'packages/db/src/schema.ts',
      location: 'packages',
      domain: 'db',
      role: 'source',
      lifecycle: 'maintained',
    });
    assert.equal(
      classifyTrackedPath('docs/plan/completed/Q.md').lifecycle,
      'archived',
    );
    assert.equal(classifyTrackedPath('apps/web/a.test.ts').role, 'test');
  });

  it('rejects unclassified roots, personal editor state, outputs, and duplicate extensions', () => {
    assert.ok(pathViolations('misc/file.ts').length > 0);
    assert.ok(pathViolations('.vscode/launch.json').length > 0);
    assert.ok(pathViolations('apps/web/.next/build.js').length > 0);
    assert.ok(pathViolations('docs/example.md.md').length > 0);
    assert.deepEqual(pathViolations('.vscode/settings.json'), []);
    assert.deepEqual(pathViolations('playwright.pr.config.ts'), []);
  });

  it('classifies every currently tracked file without a path violation', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
    const result = auditTrackedFiles(files);
    assert.equal(result.classifications.length, files.length);
    assert.deepEqual(result.violations, []);
  });

  it('freezes existing large-file debt while allowing stable or smaller files', () => {
    assert.deepEqual(
      largeSourceBaselineViolations(
        { 'stable.ts': 400, 'smaller.ts': 450 },
        { 'stable.ts': 400, 'smaller.ts': 500 },
      ),
      [],
    );
    assert.deepEqual(
      largeSourceBaselineViolations(
        { 'grown.ts': 601, 'new.ts': 400 },
        { 'grown.ts': 600 },
      ),
      [
        'grown.ts: grew from 600 to 601 lines',
        'new.ts: new 400-line source requires split or an explicit baseline decision',
      ],
    );
  });
});
