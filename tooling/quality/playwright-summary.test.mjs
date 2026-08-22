import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, it } from 'node:test';

const script = resolve('tooling/quality/playwright-summary.mjs');
const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = mkdtempSync(
    join(tmpdir(), 'educanvas-playwright-summary-'),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function runSummary(resultsPath, required, scope = 'affected') {
  return spawnSync(process.execPath, [script, resultsPath], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: {
      ...process.env,
      PLAYWRIGHT_EVIDENCE_SCOPE: scope,
      PLAYWRIGHT_RESULTS_REQUIRED: String(required),
    },
  });
}

function writeResults(directory, projects) {
  const resultsPath = join(directory, 'results.json');
  writeFileSync(
    resultsPath,
    JSON.stringify({
      suites: [
        {
          title: 'Live Voice',
          specs: [
            {
              title: 'submits one turn',
              tests: projects.map((projectName) => ({
                projectName,
                status: 'expected',
                retry: 0,
              })),
            },
          ],
        },
      ],
    }),
  );
  return resultsPath;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Playwright summary evidence semantics', () => {
  it('rejects an unknown scope without printing a stack', () => {
    const result = runSummary(
      join(temporaryDirectory(), 'missing-results.json'),
      false,
      'unknown',
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must be affected, full, or nightly/);
    assert.doesNotMatch(result.stderr, /\n\s+at\s/);
  });

  it('keeps the original upstream failure singular when no report exists', () => {
    const result = runSummary(
      join(temporaryDirectory(), 'missing-results.json'),
      false,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /上游测试未成功完成，保留原始失败/);
    assert.match(result.stdout, /affected/);
  });

  it('fails when a successful test step did not produce its required report', () => {
    const result = runSummary(
      join(temporaryDirectory(), 'missing-results.json'),
      true,
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /测试步骤成功，证据不完整/);
    assert.match(result.stdout, /affected/);
  });

  it('affected scope requires only the Chromium PR smoke project', () => {
    const resultsPath = writeResults(temporaryDirectory(), [
      'chromium-pr-smoke',
    ]);

    const result = runSummary(resultsPath, true, 'affected');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /(?:scope|证据范围)[^\n]*affected/i);
    assert.match(result.stdout, /chromium-pr-smoke ✓/);
    assert.doesNotMatch(
      result.stdout,
      /firefox ✓|firefox[^\n]*(?:已覆盖|covered)/i,
    );
  });

  for (const scope of ['full', 'nightly']) {
    it(`${scope} scope requires the complete stable browser matrix`, () => {
      const resultsPath = writeResults(temporaryDirectory(), [
        'chromium',
        'chromium-mobile',
        'firefox',
      ]);

      const result = runSummary(resultsPath, true, scope);
      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stdout,
        new RegExp(`(?:scope|证据范围)[^\\n]*${scope}`, 'i'),
      );
      assert.match(result.stdout, /chromium ✓/);
      assert.match(result.stdout, /chromium-mobile ✓/);
      assert.match(result.stdout, /firefox ✓/);
    });
  }

  it('fails an existing full report when a required browser project is absent', () => {
    const resultsPath = writeResults(temporaryDirectory(), [
      'chromium',
      'chromium-mobile',
    ]);

    const result = runSummary(resultsPath, false, 'full');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /(?:scope|证据范围)[^\n]*full/i);
    assert.match(result.stdout, /证据不完整|本范围要求但报告缺失/);
    assert.match(result.stdout, /firefox/);
    assert.doesNotMatch(
      result.stdout,
      /firefox ✓|firefox[^\n]*(?:已覆盖|covered)/i,
    );
  });
});
