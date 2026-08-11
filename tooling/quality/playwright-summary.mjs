#!/usr/bin/env node
/**
 * Playwright 结果汇总（Q05）。
 *
 * 读取 Playwright JSON reporter 输出，汇总：
 * - 各 project（浏览器/设备）覆盖矩阵——明确指出未覆盖平台；
 * - retry/flaky：retry 后通过不得完全隐藏（failOnFlakyTests 已在 CI 使
 *   flaky 用例直接失败，这里再显式报告 retry 次数与 flaky 名单）；
 * - 总数/通过/失败/跳过，与项目列表。
 *
 * 用法：
 *   node tooling/quality/playwright-summary.mjs <results.json> [--summary]
 *   --summary 时同时追加写入 $GITHUB_STEP_SUMMARY（CI）。
 *
 * 只输出聚合数字与测试标题，不采集页面正文。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [, , resultsPath = 'output/playwright/results.json'] = process.argv;
const writeSummary = process.argv.includes('--summary');
const resultsRequired = process.env.PLAYWRIGHT_RESULTS_REQUIRED === 'true';
const goldenEvidenceIndex = process.argv.indexOf('--golden-evidence');
const goldenEvidencePath =
  goldenEvidenceIndex >= 0 ? process.argv[goldenEvidenceIndex + 1] : undefined;
const evidenceSha = (
  process.env.GOLDEN_EVIDENCE_SHA ??
  process.env.EVIDENCE_SHA ??
  ''
).toLowerCase();

if (!existsSync(resultsPath)) {
  const summary = [
    '### Playwright 结果汇总（Q05）',
    '',
    resultsRequired
      ? `结果文件缺失：\`${resultsPath}\`（测试步骤成功，证据不完整）`
      : `结果文件未生成：\`${resultsPath}\`（上游测试未成功完成，保留原始失败）`,
  ].join('\n');
  if (writeSummary && process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
  }
  process.stdout.write(`${summary}\n`);
  process.exit(resultsRequired ? 1 : 0);
}

/** 递归收集 suite 下所有 test，补上 suite 名、projectName、以及 (propagated) 文件路径。 */
function collectTests(suites, acc = [], parentFile) {
  for (const suite of suites) {
    const file = suite.file ?? parentFile;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        acc.push({
          title: `${suite.title ?? ''} › ${spec.title ?? ''}`,
          projectName: test.projectName ?? suite.projectName ?? 'unknown',
          status: test.status,
          retry: test.retry ?? 0,
          file,
        });
      }
    }
    collectTests(suite.suites ?? [], acc, file);
  }
  return acc;
}

const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
const tests = collectTests(results.suites ?? []);

// ── Golden journey evidence ──
const JOURNEY_FILES = [
  { key: 'general', file: 'general-journey.spec.ts' },
  { key: 'learning', file: 'learning-journey.spec.ts' },
];

const journeys = {};
const missingJourneys = [];
for (const { key, file } of JOURNEY_FILES) {
  const matching = tests.filter((t) => t.file && t.file.endsWith(file));
  const passed = matching.filter((t) => t.status === 'expected').length;
  const failed = matching.filter((t) => t.status === 'unexpected').length;
  const flaky = matching.filter((t) => t.status === 'flaky').length;
  const retries = matching.reduce((sum, t) => sum + t.retry, 0);
  const total = matching.length;

  if (total === 0) {
    missingJourneys.push(key);
    journeys[key] = {
      passed: 0,
      total: 0,
      flaky: 0,
      failed: 0,
      retries: 0,
      status: 'missing',
      tests: [],
    };
  } else {
    journeys[key] = {
      passed,
      total,
      flaky,
      failed,
      retries,
      status: failed === 0 && flaky === 0 ? 'passed' : 'failed',
      tests: matching.map((t) => t.title),
    };
  }
}

if (goldenEvidencePath) {
  if (!evidenceSha) {
    process.stderr.write(
      '⚠  GOLDEN_EVIDENCE_SHA is empty; writing golden evidence without a commit SHA (local dev)\n',
    );
  }
  const evidence = {
    schemaVersion: 1,
    sha: evidenceSha,
    generatedAt: new Date().toISOString(),
    journeys,
    ...(missingJourneys.length ? { missing: missingJourneys } : {}),
  };
  writeFileSync(
    goldenEvidencePath,
    JSON.stringify(evidence, null, 2) + '\n',
    'utf8',
  );
}

const projects = [...new Set(tests.map((t) => t.projectName))].sort();
const byProject = Object.fromEntries(
  projects.map((p) => [
    p,
    {
      total: tests.filter((t) => t.projectName === p).length,
      passed: tests.filter(
        (t) => t.projectName === p && t.status === 'expected',
      ).length,
      flaky: tests.filter((t) => t.projectName === p && t.status === 'flaky')
        .length,
      failed: tests.filter(
        (t) => t.projectName === p && t.status === 'unexpected',
      ).length,
      skipped: tests.filter(
        (t) => t.projectName === p && t.status === 'skipped',
      ).length,
      retries: tests
        .filter((t) => t.projectName === p)
        .reduce((sum, t) => sum + t.retry, 0),
    },
  ]),
);

const retriedTests = tests.filter((t) => t.retry > 0);
const flakyTests = tests.filter((t) => t.status === 'flaky');
const failedTests = tests.filter((t) => t.status === 'unexpected');

// 覆盖矩阵：真实跑过的 device 环境 vs 期望集合。
const COVERED_DEVICES = projects.length
  ? projects.map((p) => `- ${p} ✓`).join('\n')
  : '- （无测试执行）';
const UNCOVERED = ['firefox', 'webkit']
  .filter((browser) => !projects.some((p) => p.toLowerCase().includes(browser)))
  .map((browser) => `- ${browser} ✗（未覆盖；视觉 QA 在 ui lane 覆盖 firefox）`)
  .join('\n');

// ── Golden journey section for summary ──
const journeySummaryLines = [
  '#### 黄金旅程',
  '',
  ...JOURNEY_FILES.map(({ key, file }) => {
    const j = journeys[key];
    if (!j) return `- **${key}**: 未评估`;
    const label =
      j.status === 'passed'
        ? '✓ passed'
        : j.status === 'failed'
          ? '✗ failed'
          : '⚠ missing';
    const testsPassed = `${j.passed}/${j.total}`;
    let suffix = '';
    if (j.flaky > 0) suffix += ` (flaky ${j.flaky})`;
    if (j.failed > 0) suffix += ` (failed ${j.failed})`;
    return `- **${key}** ${label} — ${testsPassed} passed${suffix}`;
  }),
  '',
  ...(missingJourneys.length
    ? [
        `⚠ 缺少黄金旅程文件：${missingJourneys.map((k) => JOURNEY_FILES.find((jf) => jf.key === k)?.file ?? k).join(', ')}`,
        '',
      ]
    : []),
];

const summary = [
  '### Playwright 结果汇总（Q05）',
  '',
  `总计 ${tests.length} | 通过 ${tests.filter((t) => t.status === 'expected').length} | flaky ${flakyTests.length} | 失败 ${failedTests.length} | 跳过 ${tests.filter((t) => t.status === 'skipped').length} | retry 总次数 ${tests.reduce((sum, t) => sum + t.retry, 0)}`,
  '',
  '#### 设备/浏览器覆盖矩阵',
  '',
  COVERED_DEVICES,
  UNCOVERED,
  '',
  ...(retriedTests.length
    ? [
        '#### 重试用例（retry > 0）',
        '',
        ...retriedTests.map(
          (t) =>
            `- [${t.status}] ${t.projectName} \`${t.title}\`（retried ${t.retry}×）`,
        ),
        '',
      ]
    : []),
  ...journeySummaryLines,
].join('\n');

if (writeSummary && process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
}
process.stdout.write(summary + '\n');
