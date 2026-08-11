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

/** 递归收集 suite 下所有 test，补上 suite 名与 projectName。 */
function collectTests(suites, acc = []) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        acc.push({
          title: `${suite.title ?? ''} › ${spec.title ?? ''}`,
          projectName: test.projectName ?? suite.projectName ?? 'unknown',
          status: test.status,
          retry: test.retry ?? 0,
        });
      }
    }
    collectTests(suite.suites ?? [], acc);
  }
  return acc;
}

const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
const tests = collectTests(results.suites ?? []);

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
].join('\n');

if (writeSummary && process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
}
process.stdout.write(summary + '\n');
