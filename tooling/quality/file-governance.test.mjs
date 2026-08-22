import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  auditTrackedFiles,
  classifyTrackedPath,
  largeSourceBaselineViolations,
  pathViolations,
  ROOT_FILE_POLICY,
} from './file-governance.mjs';

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
    assert.deepEqual(
      pathViolations('tooling/playwright/playwright.pr.config.ts'),
      [],
    );
    assert.deepEqual(pathViolations('scripts/windows/start-educanvas.ps1'), []);
    assert.deepEqual(pathViolations('config/env/local.env.example'), []);
    assert.deepEqual(pathViolations('infrastructure/compose/local.yml'), []);
    assert.ok(pathViolations('tooling/loose-script.mjs').length > 0);
    assert.ok(pathViolations('docs/old-report.pdf').length > 0);
    assert.deepEqual(pathViolations('docs/README.md'), []);
    assert.ok(pathViolations('.env.example').length > 0);
    assert.ok(pathViolations('docker-compose.yml').length > 0);
  });

  it('classifies centralized document archives as archived', () => {
    assert.equal(
      classifyTrackedPath('docs/archive/audits/old-report.pdf').lifecycle,
      'archived',
    );
  });

  it('keeps exactly seventeen justified repository-root files', () => {
    assert.equal(ROOT_FILE_POLICY.size, 17);
    assert.ok(
      [...ROOT_FILE_POLICY.values()].every((reason) => reason.length > 0),
    );
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
      largeSourceBaselineViolations({ 'stable.ts': 400, 'smaller.ts': 450 }, [
        debt('stable.ts', 400, '0001'),
        debt('smaller.ts', 500, '0002'),
      ]),
      [],
    );
    assert.deepEqual(
      largeSourceBaselineViolations({ 'grown.ts': 601, 'new.ts': 400 }, [
        debt('grown.ts', 600, '0001'),
      ]),
      [
        'grown.ts: grew from 600 to 601 lines',
        'new.ts: new 400-line source requires split or an explicit baseline decision',
      ],
    );
  });

  it('rejects expired, duplicated, ownerless and stale debt records', () => {
    const invalid = debt('old.ts', 500, '0001');
    invalid.owner = '';
    invalid.expiry = '2020-01-01';
    assert.ok(
      largeSourceBaselineViolations({}, [invalid, { ...invalid }]).length >= 4,
    );
  });
});

function debt(file, acceptedLines, sequence) {
  return {
    file,
    owner: 'developer-productivity',
    reason: 'Existing debt pending bounded extraction.',
    targetLines: 400,
    issue: `internal:ARCH-DEBT-${sequence}`,
    expiry: '2027-02-28',
    acceptedLines,
  };
}
