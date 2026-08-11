#!/usr/bin/env node
/**
 * AI Product Evidence v2 — unified, sanitized, SHA-bound CI evidence.
 *
 * Reads:
 * - CI lane expected/results from environment (via ci-impact.mjs exports)
 * - Eval reports from downloaded agent-eval artifact
 * - Golden journey results from downloaded e2e artifact
 * - Baselines from tooling/evals/baselines/
 *
 * Outputs:
 * - Machine-readable JSON evidence artifact
 * - GitHub Step Summary markdown
 *
 * Any missing required report, SHA mismatch, dataset version drift,
 * or threshold failure causes exit code 1.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expectedResultsFromEnvironment,
  laneResultsFromEnvironment,
  requiredResultFailures,
} from './ci-impact.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function loadJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// Reuse eval-gate's sanitization logic
const FORBIDDEN_REPORT_KEY =
  /(?:prompt|message|provider.?body|secret|api.?key|audio|student.?content)/i;
function assertSanitized(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertSanitized(entry, `${path}[${index}]`),
    );
    return;
  }
  if (typeof value === 'string') {
    if (/(?:bearer\s+|api[_-]?key\s*[:=]|\bsk-[a-z0-9]{12,})/i.test(value))
      throw new Error(`evidence contains secret-like text: ${path}`);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_KEY.test(key))
      throw new Error(`evidence contains forbidden field: ${path}.${key}`);
    assertSanitized(entry, `${path}.${key}`);
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

export function buildAiProductEvidence({
  sha,
  event,
  expected,
  results,
  evalReportsDir, // path to downloaded eval reports dir (or null)
  playwrightResultsPath, // path to results.json (or null)
  baselinesDir, // path to baselines dir
  generatedAt = new Date().toISOString(),
  now = Date.now(),
}) {
  // Validate SHA
  if (!SHA_PATTERN.test(sha ?? '') || /^0+$/.test(sha)) {
    throw new Error('ai-product-evidence requires a non-zero 40-character SHA');
  }
  const shaLower = sha.toLowerCase();

  // 1. Required failures (reuse ci-impact logic)
  const requiredFailures = requiredResultFailures({
    eventName: event,
    expected,
    results,
  });

  // 2. Eval section (agent_eval lane)
  const evalSection = {
    status: 'not_applicable',
    datasets: null,
    metrics: null,
    shaMatch: true,
    versionDrift: false,
    thresholdFailure: false,
  };
  if (expected.agent_eval) {
    if (results.agent_eval !== 'success') {
      evalSection.status =
        results.agent_eval === 'skipped' ? 'not_applicable' : 'failed';
      if (results.agent_eval !== 'skipped') evalSection.status = 'failed';
    } else {
      // Lane succeeded — read eval reports
      const gatePath = evalReportsDir
        ? `${evalReportsDir}/eval-gate-v1.json`
        : null;
      const gateReport = gatePath ? loadJson(gatePath) : null;
      if (!gateReport) {
        evalSection.status = 'missing';
      } else {
        assertSanitized(gateReport);
        // SHA binding
        if (gateReport.sha !== shaLower) {
          evalSection.shaMatch = false;
        }
        // Dataset version drift: compare gate datasets against baselines
        const ragBaseline = baselinesDir
          ? loadJson(`${baselinesDir}/rag-v1.json`)
          : null;
        const agentBaseline = baselinesDir
          ? loadJson(`${baselinesDir}/agent-v1.json`)
          : null;
        let drift = false;
        if (
          ragBaseline &&
          gateReport.datasets?.rag !== ragBaseline.datasetVersion
        )
          drift = true;
        if (
          agentBaseline &&
          gateReport.datasets?.agent !== agentBaseline.datasetVersion
        )
          drift = true;
        evalSection.versionDrift = drift;
        evalSection.thresholdFailure = !gateReport.passed;
        evalSection.status = gateReport.passed && !drift ? 'passed' : 'failed';
        evalSection.datasets = gateReport.datasets;
        // Extract key metrics from comparisons
        const metrics = {};
        for (const comparison of gateReport.comparisons ?? []) {
          metrics[comparison.metric] = {
            actual: comparison.actual,
            minimum: comparison.minimum,
            passed: comparison.passed,
          };
        }
        evalSection.metrics = metrics;
      }
    }
  }

  // 3. Golden journey section (e2e lane)
  const goldenSection = {
    status: 'not_applicable',
    journeys: {},
    missing: [],
    shaMatch: true,
  };
  if (expected.e2e) {
    if (results.e2e !== 'success') {
      goldenSection.status =
        results.e2e === 'skipped' ? 'not_applicable' : 'failed';
    } else {
      const journeyEvidencePath = playwrightResultsPath
        ? dirname(playwrightResultsPath) + '/golden-journey-evidence.json'
        : null;
      const goldenEvidence = journeyEvidencePath
        ? loadJson(journeyEvidencePath)
        : null;
      const resultsJson = playwrightResultsPath
        ? loadJson(playwrightResultsPath)
        : null;

      if (!goldenEvidence && !resultsJson) {
        goldenSection.status = 'missing';
      } else {
        // SHA binding
        if (!goldenEvidence?.sha || goldenEvidence.sha !== shaLower) {
          goldenSection.shaMatch = false;
        }

        if (goldenEvidence?.journeys) {
          goldenSection.journeys = goldenEvidence.journeys;
          goldenSection.missing = goldenEvidence.missing ?? [];
        } else if (resultsJson) {
          // Fallback: extract from results.json directly
          goldenSection.journeys = extractJourneysFromResults(resultsJson);
          goldenSection.missing = Object.entries(goldenSection.journeys)
            .filter(([, journey]) => journey.status === 'missing')
            .map(([key]) => key);
        }

        const hasFailed = Object.values(goldenSection.journeys).some(
          (journey) => journey.status === 'failed',
        );
        const hasMissing = goldenSection.missing.length > 0;
        goldenSection.status =
          hasFailed || hasMissing || !goldenSection.shaMatch
            ? 'failed'
            : 'passed';
      }
    }
  }

  // 4. Retry/flaky summary (from playwright results)
  let retriesSummary = null;
  if (playwrightResultsPath) {
    const resultsJson = loadJson(playwrightResultsPath);
    if (resultsJson) {
      retriesSummary = extractRetriesSummary(resultsJson);
    }
  }

  // 5. Build evidence
  const verdict =
    requiredFailures.length === 0 &&
    evalSection.status !== 'failed' &&
    evalSection.status !== 'missing' &&
    goldenSection.status !== 'failed' &&
    goldenSection.status !== 'missing' &&
    goldenSection.shaMatch &&
    evalSection.shaMatch &&
    !evalSection.versionDrift;

  return {
    schemaVersion: 2,
    sha: shaLower,
    event,
    generatedAt,
    verdict: verdict ? 'PASS' : 'FAIL',
    lanes: {
      expected: { ...expected },
      results: { ...results },
      requiredFailures,
    },
    eval: evalSection,
    goldenJourneys: goldenSection,
    retries: retriesSummary,
    evidenceClaims: {
      deterministic: [
        'CI lane routing via path classifier (ci-impact.mjs)',
        'Deterministic Agent eval: ToolKernel + TeachingOutputSafetyGate (frozen synthetic dataset)',
        'RAG evaluation: hybrid recall/MRR/nDCG (frozen synthetic dataset)',
        'Golden journey E2E: Playwright Chromium (turn lifecycle, SSE, Canvas, Progress)',
      ],
      providerEvidence: [
        'Provider Canary: DashScope CosyVoice TTS + Paraformer ASR (workflow_dispatch only, not in PR)',
      ],
      humanVerification: [
        'Live Voice hotword validation (requires human operator)',
        'Full nightly regression matrix (Firefox + mobile, requires human signoff)',
        'Real course content quality (requires teacher/advisor review)',
      ],
      claimsSupported: [
        'Agent tool and safety policy changes are covered by frozen deterministic eval',
        'General and Learning golden journeys prove core user-facing flows',
        'All conclusions are SHA-bound to the evaluated commit',
      ],
      claimsNotSupported: [
        'Does NOT prove real-course semantic quality or teaching effectiveness',
        'Does NOT prove production SLO or latency targets',
        'Does NOT cover Provider-specific regressions (covered by Provider Canary)',
        'Does NOT cover visual regression or accessibility (covered by @ui lane)',
      ],
    },
  };
}

// Helper: extract journey results from results.json
function extractJourneysFromResults(resultsJson) {
  const JOURNEY_FILES = {
    general: 'general-journey.spec',
    learning: 'learning-journey.spec',
  };
  const journeys = {};
  const allTests = collectAllTests(resultsJson.suites ?? []);
  for (const [key, match] of Object.entries(JOURNEY_FILES)) {
    const matching = allTests.filter((test) => test.file?.includes(match));
    const total = matching.length;
    const failed = matching.filter(
      (test) => test.status === 'unexpected',
    ).length;
    const flaky = matching.filter((test) => test.status === 'flaky').length;
    const retries = matching.reduce((sum, test) => sum + (test.retry ?? 0), 0);
    journeys[key] = {
      total,
      passed: matching.filter((test) => test.status === 'expected').length,
      failed,
      flaky,
      retries,
      status:
        total === 0 ? 'missing' : failed > 0 || flaky > 0 ? 'failed' : 'passed',
      tests: matching.map((test) => test.title),
    };
  }
  return journeys;
}

function collectAllTests(suites, acc = [], parentFile) {
  for (const suite of suites) {
    const file = suite.file ?? parentFile;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        acc.push({
          title: `${suite.title ?? ''} › ${spec.title ?? ''}`,
          status: test.status,
          retry: test.retry ?? 0,
          file,
        });
      }
    }
    collectAllTests(suite.suites ?? [], acc, file);
  }
  return acc;
}

function extractRetriesSummary(resultsJson) {
  const allTests = collectAllTests(resultsJson.suites ?? []);
  const retried = allTests.filter((test) => test.retry > 0);
  const flaky = allTests.filter((test) => test.status === 'flaky');
  return {
    totalRetries: retried.reduce((sum, test) => sum + test.retry, 0),
    retriedCount: retried.length,
    flakyCount: flaky.length,
    retriedTests: retried.map((test) => ({
      title: test.title,
      retries: test.retry,
      status: test.status,
    })),
  };
}

export function buildMarkdownSummary(evidence) {
  const lines = [
    '### AI Product Evidence v2',
    '',
    `**Verdict: ${evidence.verdict}**`,
    `SHA: \`${evidence.sha.slice(0, 12)}\` | Event: ${evidence.event} | Generated: ${evidence.generatedAt}`,
    '',
  ];

  // Lanes table
  lines.push('#### CI Lanes');
  lines.push('');
  lines.push('| Lane | Expected | Result | Required |');
  lines.push('|------|----------|--------|----------|');
  const laneNames = Object.keys(evidence.lanes.expected);
  for (const lane of laneNames) {
    const expectedLane = evidence.lanes.expected[lane];
    const result = evidence.lanes.results[lane] ?? 'skipped';
    const isRequired = evidence.lanes.requiredFailures.some((failure) =>
      failure.startsWith(lane),
    );
    lines.push(
      `| ${lane} | ${expectedLane ? 'yes' : 'no'} | ${result} | ${isRequired ? '⚠️' : '—'} |`,
    );
  }
  lines.push('');

  // Eval section
  lines.push('#### Agent Eval & RAG');
  lines.push('');
  if (evidence.eval.status === 'not_applicable') {
    lines.push('*Not applicable for this PR (no agent-affecting paths)*');
  } else if (evidence.eval.status === 'missing') {
    lines.push('⚠️ **MISSING**: eval report not found — required but absent');
  } else if (evidence.eval.status === 'failed') {
    lines.push(`**Status: FAILED**`);
    if (!evidence.eval.shaMatch)
      lines.push('- ⚠️ SHA mismatch between eval report and evaluated commit');
    if (evidence.eval.versionDrift)
      lines.push(
        '- ⚠️ Dataset version drift detected between report and baseline',
      );
    if (evidence.eval.thresholdFailure)
      lines.push('- ⚠️ One or more threshold checks failed');
  } else {
    lines.push('**Status: PASSED**');
  }
  if (evidence.eval.datasets) {
    lines.push(`- RAG dataset: \`${evidence.eval.datasets.rag}\``);
    lines.push(`- Agent dataset: \`${evidence.eval.datasets.agent}\``);
  }
  if (evidence.eval.metrics) {
    lines.push('');
    for (const [metric, { actual, minimum, passed }] of Object.entries(
      evidence.eval.metrics,
    )) {
      lines.push(
        `- ${passed ? '✅' : '❌'} ${metric}: ${actual ?? 'missing'} (minimum ${minimum})`,
      );
    }
  }
  lines.push('');

  // Golden journeys
  lines.push('#### Golden Journeys');
  lines.push('');
  if (evidence.goldenJourneys.status === 'not_applicable') {
    lines.push('*Not applicable for this PR (no E2E required)*');
  } else if (evidence.goldenJourneys.status === 'missing') {
    lines.push('⚠️ **MISSING**: golden journey evidence not found');
  } else {
    if (!evidence.goldenJourneys.shaMatch) {
      lines.push('- ⚠️ SHA mismatch or missing SHA in golden journey evidence');
    }
    for (const [key, journey] of Object.entries(
      evidence.goldenJourneys.journeys,
    )) {
      const icon =
        journey.status === 'passed'
          ? '✅'
          : journey.status === 'failed'
            ? '❌'
            : '⚪';
      lines.push(
        `- ${icon} **${key}**: ${journey.passed}/${journey.total} passed, ${journey.flaky} flaky, ${journey.retries} retries`,
      );
    }
    if (evidence.goldenJourneys.missing.length > 0) {
      lines.push(
        `- ⚠️ Missing journey files: ${evidence.goldenJourneys.missing.join(', ')}`,
      );
    }
  }
  lines.push('');

  // Evidence claims
  lines.push('#### Evidence Claims');
  lines.push('');
  lines.push('**Deterministic automatic evidence:**');
  for (const claim of evidence.evidenceClaims.deterministic)
    lines.push(`- ${claim}`);
  lines.push('');
  lines.push('**Real provider evidence:**');
  for (const claim of evidence.evidenceClaims.providerEvidence)
    lines.push(`- ${claim}`);
  lines.push('');
  lines.push('**Requires human verification:**');
  for (const claim of evidence.evidenceClaims.humanVerification)
    lines.push(`- ${claim}`);
  lines.push('');
  lines.push('**This report supports:**');
  for (const claim of evidence.evidenceClaims.claimsSupported)
    lines.push(`- ${claim}`);
  lines.push('');
  lines.push('**This report does NOT support:**');
  for (const claim of evidence.evidenceClaims.claimsNotSupported)
    lines.push(`- ${claim}`);

  return lines.join('\n');
}

function main() {
  const output = argument('--output');
  if (!output) throw new Error('--output is required');
  const evalReportsDir = argument('--eval-reports') || null;
  const playwrightResultsPath = argument('--playwright-results') || null;
  const baselinesDir =
    argument('--baselines') ??
    resolve(
      fileURLToPath(new URL('../../tooling/evals/baselines', import.meta.url)),
    );
  const writeSummary = process.argv.includes('--summary');

  const evidence = buildAiProductEvidence({
    sha: argument('--sha'),
    event: argument('--event'),
    expected: expectedResultsFromEnvironment(),
    results: laneResultsFromEnvironment(),
    evalReportsDir,
    playwrightResultsPath,
    baselinesDir,
  });

  const outputPath = resolve(output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  const markdown = buildMarkdownSummary(evidence);
  process.stdout.write(`${markdown}\n`);
  if (writeSummary && process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, {
      encoding: 'utf8',
      flag: 'a',
    });
  }

  if (evidence.verdict !== 'PASS') process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
