import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  buildAiProductEvidence,
  buildMarkdownSummary,
} from './ai-product-evidence.mjs';

const VALID_SHA = 'a'.repeat(40);
const ZERO_SHA = '0'.repeat(40);
const SHORT_SHA = 'abc123';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'evidence-test-'));
}

function emptyExpected() {
  return {
    checks: false,
    db_integration: false,
    e2e: false,
    agent_eval: false,
  };
}

function emptyResults() {
  return {
    changes: 'success',
    secret_scan: 'success',
    e2e: 'not_run',
    agent_eval: 'not_run',
  };
}

describe('AI Product Evidence v2', () => {
  let tmp;
  beforeEach(() => {
    tmp = tmpDir();
  });
  afterEach(() => {});

  describe('SHA validation', () => {
    it('throws on missing SHA', () => {
      assert.throws(
        () =>
          buildAiProductEvidence({
            sha: null,
            event: 'pull_request',
            expected: emptyExpected(),
            results: emptyResults(),
            evalReportsDir: null,
            playwrightResultsPath: null,
            baselinesDir: null,
          }),
        /non-zero 40-character SHA/,
      );
    });

    it('throws on short SHA', () => {
      assert.throws(
        () =>
          buildAiProductEvidence({
            sha: SHORT_SHA,
            event: 'pull_request',
            expected: emptyExpected(),
            results: emptyResults(),
            evalReportsDir: null,
            playwrightResultsPath: null,
            baselinesDir: null,
          }),
        /non-zero 40-character SHA/,
      );
    });

    it('throws on all-zeros SHA', () => {
      assert.throws(
        () =>
          buildAiProductEvidence({
            sha: ZERO_SHA,
            event: 'pull_request',
            expected: emptyExpected(),
            results: emptyResults(),
            evalReportsDir: null,
            playwrightResultsPath: null,
            baselinesDir: null,
          }),
        /non-zero 40-character SHA/,
      );
    });

    it('accepts valid 40-char hex SHA', () => {
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected: emptyExpected(),
        results: emptyResults(),
        evalReportsDir: null,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      assert.equal(evidence.sha, VALID_SHA);
    });
  });

  describe('Required failures', () => {
    it('populates requiredFailures when expected lane fails', () => {
      const expected = { ...emptyExpected(), agent_eval: true };
      const results = { ...emptyResults(), agent_eval: 'failed' };
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected,
        results,
        evalReportsDir: null,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      assert.ok(evidence.lanes.requiredFailures.length > 0);
      assert.ok(
        evidence.lanes.requiredFailures.some((f) => f.startsWith('agent_eval')),
      );
    });

    it('empty requiredFailures when all lanes succeed or are skipped', () => {
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected: emptyExpected(),
        results: emptyResults(),
        evalReportsDir: null,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      assert.equal(evidence.lanes.requiredFailures.length, 0);
    });
  });

  describe('Eval section', () => {
    it('not_applicable when agent_eval not expected', () => {
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected: emptyExpected(),
        results: emptyResults(),
        evalReportsDir: null,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      assert.equal(evidence.eval.status, 'not_applicable');
    });

    it('missing when agent_eval expected and succeeded but no report file', () => {
      const expected = { ...emptyExpected(), agent_eval: true };
      const results = { ...emptyResults(), agent_eval: 'success' };
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected,
        results,
        evalReportsDir: null,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      assert.equal(evidence.eval.status, 'missing');
    });

    it('SHA mismatch when gate report SHA differs', () => {
      const gateReport = {
        schemaVersion: 1,
        sha: 'b'.repeat(40),
        datasets: { rag: 'rag-v1', agent: 'agent-v1' },
        scope: ['rag', 'agent'],
        passed: true,
        comparisons: [],
      };
      const gateDir = join(tmp, 'eval-reports');
      mkdirSync(gateDir, { recursive: true });
      writeFileSync(
        join(gateDir, 'eval-gate-v1.json'),
        JSON.stringify(gateReport),
      );

      const expected = { ...emptyExpected(), agent_eval: true };
      const results = { ...emptyResults(), agent_eval: 'success' };
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected,
        results,
        evalReportsDir: gateDir,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      assert.equal(evidence.eval.shaMatch, false);
    });

    it('treats an eval report without a SHA as unbound evidence', () => {
      const gateDir = join(tmp, 'eval-reports');
      mkdirSync(gateDir, { recursive: true });
      writeFileSync(
        join(gateDir, 'eval-gate-v1.json'),
        JSON.stringify({
          schemaVersion: 1,
          datasets: { rag: 'rag-v1', agent: 'agent-v1' },
          passed: true,
          comparisons: [],
        }),
      );

      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected: { ...emptyExpected(), agent_eval: true },
        results: { ...emptyResults(), agent_eval: 'success' },
        evalReportsDir: gateDir,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      assert.equal(evidence.eval.shaMatch, false);
      assert.equal(evidence.verdict, 'FAIL');
    });

    it('version drift when datasets mismatch baselines', () => {
      const gateReport = {
        schemaVersion: 1,
        sha: VALID_SHA,
        datasets: { rag: 'rag-v99', agent: 'agent-v99' },
        scope: ['rag', 'agent'],
        passed: true,
        comparisons: [],
      };
      const gateDir = join(tmp, 'eval-reports');
      mkdirSync(gateDir, { recursive: true });
      writeFileSync(
        join(gateDir, 'eval-gate-v1.json'),
        JSON.stringify(gateReport),
      );

      const baselinesDir = join(tmp, 'baselines');
      mkdirSync(baselinesDir, { recursive: true });
      writeFileSync(
        join(baselinesDir, 'rag-v1.json'),
        JSON.stringify({ datasetVersion: 'rag-v1', thresholds: {} }),
      );
      writeFileSync(
        join(baselinesDir, 'agent-v1.json'),
        JSON.stringify({ datasetVersion: 'agent-v1', thresholds: {} }),
      );

      const expected = { ...emptyExpected(), agent_eval: true };
      const results = { ...emptyResults(), agent_eval: 'success' };
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected,
        results,
        evalReportsDir: gateDir,
        playwrightResultsPath: null,
        baselinesDir,
      });
      assert.equal(evidence.eval.versionDrift, true);
    });
  });

  describe('Golden journeys section', () => {
    it('not_applicable when e2e not expected', () => {
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected: emptyExpected(),
        results: emptyResults(),
        evalReportsDir: null,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      assert.equal(evidence.goldenJourneys.status, 'not_applicable');
    });

    it('missing when e2e succeeded but no evidence files', () => {
      const expected = { ...emptyExpected(), e2e: true };
      const results = { ...emptyResults(), e2e: 'success' };
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected,
        results,
        evalReportsDir: null,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      assert.equal(evidence.goldenJourneys.status, 'missing');
      assert.equal(evidence.verdict, 'FAIL');
    });

    it('fails closed when golden journey evidence is bound to another SHA', () => {
      const e2eDir = join(tmp, 'e2e-results');
      mkdirSync(e2eDir, { recursive: true });
      writeFileSync(
        join(e2eDir, 'golden-journey-evidence.json'),
        JSON.stringify({
          schemaVersion: 1,
          sha: 'b'.repeat(40),
          journeys: {
            general: { status: 'passed', passed: 1, total: 1 },
            learning: { status: 'passed', passed: 1, total: 1 },
          },
        }),
      );

      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected: { ...emptyExpected(), e2e: true },
        results: { ...emptyResults(), e2e: 'success' },
        evalReportsDir: null,
        playwrightResultsPath: join(e2eDir, 'results.json'),
        baselinesDir: null,
      });
      assert.equal(evidence.goldenJourneys.shaMatch, false);
      assert.equal(evidence.goldenJourneys.status, 'failed');
      assert.equal(evidence.verdict, 'FAIL');
    });
  });

  describe('Verdict', () => {
    it('PASS when all lanes pass, no eval failures, golden passes', () => {
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected: emptyExpected(),
        results: emptyResults(),
        evalReportsDir: null,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      assert.equal(evidence.verdict, 'PASS');
    });

    it('FAIL when required lane fails', () => {
      const expected = { ...emptyExpected(), agent_eval: true };
      const results = { ...emptyResults(), agent_eval: 'failed' };
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected,
        results,
        evalReportsDir: null,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      assert.equal(evidence.verdict, 'FAIL');
    });
  });

  describe('buildMarkdownSummary', () => {
    it('returns string with evidence title and verdict', () => {
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected: emptyExpected(),
        results: emptyResults(),
        evalReportsDir: null,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      const md = buildMarkdownSummary(evidence);
      assert.ok(typeof md === 'string');
      assert.ok(md.includes('AI Product Evidence v2'));
      assert.ok(md.includes('PASS'));
    });

    it('includes FAIL verdict in markdown', () => {
      const expected = { ...emptyExpected(), agent_eval: true };
      const results = { ...emptyResults(), agent_eval: 'failed' };
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected,
        results,
        evalReportsDir: null,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      const md = buildMarkdownSummary(evidence);
      assert.ok(md.includes('FAIL'));
    });
  });

  describe('Evidence structure', () => {
    it('has schemaVersion 2', () => {
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'push',
        expected: emptyExpected(),
        results: emptyResults(),
        evalReportsDir: null,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      assert.equal(evidence.schemaVersion, 2);
    });

    it('includes evidenceClaims with deterministic list', () => {
      const evidence = buildAiProductEvidence({
        sha: VALID_SHA,
        event: 'pull_request',
        expected: emptyExpected(),
        results: emptyResults(),
        evalReportsDir: null,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      assert.ok(Array.isArray(evidence.evidenceClaims.deterministic));
      assert.ok(evidence.evidenceClaims.deterministic.length > 0);
    });

    it('normalizes SHA to lowercase', () => {
      const upperSha = 'A'.repeat(40);
      const evidence = buildAiProductEvidence({
        sha: upperSha,
        event: 'pull_request',
        expected: emptyExpected(),
        results: emptyResults(),
        evalReportsDir: null,
        playwrightResultsPath: null,
        baselinesDir: null,
      });
      assert.equal(evidence.sha, upperSha.toLowerCase());
    });
  });
});
