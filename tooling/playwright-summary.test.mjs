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

function runSummary(resultsPath, required) {
  return spawnSync(process.execPath, [script, resultsPath], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: {
      ...process.env,
      PLAYWRIGHT_RESULTS_REQUIRED: String(required),
    },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Playwright summary evidence semantics', () => {
  it('keeps the original upstream failure singular when no report exists', () => {
    const result = runSummary(
      join(temporaryDirectory(), 'missing-results.json'),
      false,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /上游测试未成功完成，保留原始失败/);
  });

  it('fails when a successful test step did not produce its required report', () => {
    const result = runSummary(
      join(temporaryDirectory(), 'missing-results.json'),
      true,
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /测试步骤成功，证据不完整/);
  });

  it('summarizes an existing report without changing current coverage semantics', () => {
    const resultsPath = join(temporaryDirectory(), 'results.json');
    writeFileSync(
      resultsPath,
      JSON.stringify({
        suites: [
          {
            title: 'Live Voice',
            specs: [
              {
                title: 'submits one turn',
                tests: [
                  {
                    projectName: 'chromium-pr-smoke',
                    status: 'expected',
                    retry: 0,
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    const result = runSummary(resultsPath, true);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /总计 1 \| 通过 1/);
    assert.match(result.stdout, /chromium-pr-smoke ✓/);
  });
});
