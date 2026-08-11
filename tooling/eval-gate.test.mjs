import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateReports } from './evals/eval-gate.mjs';

const ragBaseline = {
  datasetVersion: 'v1',
  scope: 'synthetic rag',
  thresholds: {
    'hybrid.meanRecall10': 0.95,
    'hybrid.meanMRR10': 0.8,
    'hybrid.meanNDCG10': 0.85,
    fallbackHonesty: 1,
  },
};
const agentBaseline = {
  datasetVersion: 'agent-v1',
  scope: 'synthetic agent',
  thresholds: {
    'toolArtifact.passRate': 1,
    'teachingSafetyCritical.passRate': 1,
    'teachingSafetyNonCritical.average': 1,
  },
};
const ragReport = {
  dataset: { version: 'v1' },
  retrievers: {
    hybrid: { meanRecall10: 1, meanMRR10: 0.9, meanNDCG10: 0.9 },
  },
  fallbackHonesty: { matchesFts: true },
};
const agentReport = {
  datasetVersion: 'agent-v1',
  summary: {
    toolArtifact: { passed: 12, total: 12 },
    teachingSafetyCritical: { passed: 20, total: 20 },
    teachingSafetyNonCritical: { average: 1, total: 3 },
  },
};

describe('deterministic evaluation gate', () => {
  it('passes only when every independent threshold passes', () => {
    const result = evaluateReports({
      ragReport,
      ragBaseline,
      agentReport,
      agentBaseline,
    });
    assert.equal(result.passed, true);
    assert.ok(result.comparisons.every((entry) => entry.passed));
  });

  it('reports metric regressions without averaging away critical failures', () => {
    const result = evaluateReports({
      ragReport,
      ragBaseline,
      agentReport: {
        ...agentReport,
        summary: {
          ...agentReport.summary,
          teachingSafetyCritical: { passed: 19, total: 20 },
        },
      },
      agentBaseline,
    });
    assert.equal(result.passed, false);
    assert.deepEqual(
      result.comparisons
        .filter((entry) => !entry.passed)
        .map((entry) => entry.metric),
      ['agent.teachingSafetyCritical.passRate'],
    );
  });

  it('rejects reports that contain raw prompt or provider fields', () => {
    assert.throws(
      () =>
        evaluateReports({
          ragReport,
          ragBaseline,
          agentReport: { ...agentReport, providerBody: 'untrusted' },
          agentBaseline,
        }),
      /forbidden field/,
    );
    assert.throws(
      () =>
        evaluateReports({
          ragReport,
          ragBaseline,
          agentReport: { ...agentReport, note: 'Bearer secret-token-value' },
          agentBaseline,
        }),
      /secret-like text/,
    );
  });
});
