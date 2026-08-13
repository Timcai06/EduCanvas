import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCiEvidence } from './quality/ci-evidence.mjs';

const sha = 'a'.repeat(40);
const expected = {
  checks: true,
  db_integration: false,
  worker_integration: false,
  migration_integration: false,
  windows: false,
  runtime_pressure: false,
  e2e: false,
  agent_eval: true,
  dependency_review: false,
  release_evidence: false,
  desktop: false,
};
const successfulResults = {
  changes: 'success',
  secret_scan: 'success',
  dependency_review: 'skipped',
  quality_static: 'success',
  quality_tests: 'success',
  db_integration: 'skipped',
  worker_integration: 'skipped',
  migration_integration: 'skipped',
  windows: 'skipped',
  runtime_pressure: 'skipped',
  e2e: 'skipped',
  agent_eval: 'success',
  release_evidence: 'skipped',
  desktop_build: 'skipped',
};

describe('SHA-bound CI evidence', () => {
  it('records classifier expectations and successful required results', () => {
    assert.deepEqual(
      buildCiEvidence({
        sha,
        event: 'pull_request',
        expected,
        results: successfulResults,
        generatedAt: '2026-08-11T00:00:00.000Z',
      }),
      {
        schemaVersion: 2,
        sha,
        event: 'pull_request',
        expected,
        results: successfulResults,
        e2eEvidence: {
          scope: 'affected',
          decision: 'skip',
          verification: 'not_applicable',
          requiredProjects: [],
          pendingExternal: [
            'safari_webkit',
            'real_provider_canary',
            'real_microphone',
            'real_external_services',
          ],
        },
        requiredFailures: [],
        generatedAt: '2026-08-11T00:00:00.000Z',
      },
    );
  });

  it('records failures without hiding them or throwing', () => {
    const evidence = buildCiEvidence({
      sha,
      event: 'push',
      expected,
      results: { ...successfulResults, agent_eval: 'failure' },
    });
    assert.deepEqual(evidence.requiredFailures, [
      'agent_eval was required but concluded: failure',
    ]);
  });

  it('records full and nightly E2E as distinct pending evidence scopes', () => {
    for (const [event, scope] of [
      ['workflow_dispatch', 'full'],
      ['schedule', 'nightly'],
    ]) {
      const evidence = buildCiEvidence({
        sha,
        event,
        expected: { ...expected, e2e: true },
        results: { ...successfulResults, e2e: 'skipped' },
      });
      assert.deepEqual(evidence.e2eEvidence, {
        scope,
        decision: 'run',
        verification: 'pending',
        requiredProjects: ['chromium', 'chromium-mobile', 'firefox'],
        pendingExternal: [
          'safari_webkit',
          'real_provider_canary',
          'real_microphone',
          'real_external_services',
        ],
      });
    }
  });

  it('records an executed E2E failure as failed rather than pending', () => {
    const evidence = buildCiEvidence({
      sha,
      event: 'schedule',
      expected: { ...expected, e2e: true },
      results: { ...successfulResults, e2e: 'failure' },
    });
    assert.equal(evidence.e2eEvidence.verification, 'failed');
  });

  it('rejects unbound or unsupported evidence identities', () => {
    assert.throws(
      () =>
        buildCiEvidence({
          sha: 'main',
          event: 'push',
          expected,
          results: successfulResults,
        }),
      /40-character SHA/,
    );
    assert.throws(
      () =>
        buildCiEvidence({
          sha,
          event: 'repository_dispatch',
          expected,
          results: successfulResults,
        }),
      /unsupported CI event/,
    );
  });
});
