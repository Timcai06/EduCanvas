import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = resolve(import.meta.dirname, '..');
const e2eRoot = resolve(repoRoot, 'tests/e2e');

function smokeFiles() {
  return readdirSync(e2eRoot)
    .filter((name) => name.endsWith('.spec.ts'))
    .filter((name) =>
      /test\(\s*['"]@smoke\b/.test(
        readFileSync(resolve(e2eRoot, name), 'utf8'),
      ),
    )
    .sort();
}

describe('E2E suite routing', () => {
  it('keeps the PR smoke budget small and cross-domain', () => {
    const files = smokeFiles();
    assert.deepEqual(files, [
      'account-flow.spec.ts',
      'artifact-flow.spec.ts',
      'canvas-resource-access.spec.ts',
      'general-journey.spec.ts',
      'hydration.spec.ts',
      'learning-journey.spec.ts',
      'live-voice-flow.spec.ts',
      'pdf-reading-switch.spec.ts',
      'profile-activity.spec.ts',
      'sandbox-preview.spec.ts',
    ]);
    const count = files.reduce((total, name) => {
      const source = readFileSync(resolve(e2eRoot, name), 'utf8');
      return total + (source.match(/test\(\s*['"]@smoke\b/g)?.length ?? 0);
    }, 0);
    assert.ok(count >= 6 && count <= 14, `PR smoke budget is ${count}`);
    assert.deepEqual(
      files.filter((name) =>
        [
          'artifact-flow.spec.ts',
          'live-voice-flow.spec.ts',
          'canvas-resource-access.spec.ts',
        ].includes(name),
      ),
      [
        'artifact-flow.spec.ts',
        'canvas-resource-access.spec.ts',
        'live-voice-flow.spec.ts',
      ],
    );
  });

  it('routes PRs to smoke while keeping UI review nightly or manual', () => {
    const prConfig = readFileSync(
      resolve(repoRoot, 'playwright.pr.config.ts'),
      'utf8',
    );
    const ci = readFileSync(
      resolve(repoRoot, '.github/workflows/ci.yml'),
      'utf8',
    );
    const ui = readFileSync(
      resolve(repoRoot, '.github/workflows/ui.yml'),
      'utf8',
    );

    assert.match(prConfig, /grep: \/@smoke\//);
    assert.match(prConfig, /chromium-pr-smoke/);
    assert.match(ci, /pnpm test:e2e:pr/);
    assert.match(ci, /Full browser E2E/);
    assert.match(ci, /github\.event_name == 'schedule'/);
    assert.doesNotMatch(ui, /^\s*pull_request:/m);
    assert.match(ui, /^\s*schedule:/m);
    assert.match(ui, /^\s*workflow_dispatch:/m);
    assert.match(ui, /playwright install --with-deps chromium firefox/);
    assert.match(ui, /--config playwright\.ui\.config\.ts/);
    assert.match(ui, /Full UI review/);
  });

  it('keeps Live Voice browser evidence synthetic and Provider-independent', () => {
    const story = readFileSync(
      resolve(e2eRoot, 'live-voice-flow.spec.ts'),
      'utf8',
    );
    const fixture = readFileSync(
      resolve(e2eRoot, 'fixtures/live-voice-fixture.ts'),
      'utf8',
    );

    assert.equal(story.match(/test\(\s*['"]@smoke\b/g)?.length, 1);
    assert.match(story, /speechAbort/);
    assert.match(story, /asset-processing-1/);
    assert.match(fixture, /MediaStreamDestination/);
    assert.match(fixture, /voice-fixture\.invalid/);
    assert.doesNotMatch(fixture, /DASHSCOPE_API_KEY|SILICONFLOW_API_KEY/);
  });
});
