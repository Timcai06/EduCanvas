import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  MAX_PROVIDER_CANARY_SCENARIOS,
  MAX_PROVIDER_TURNS_PER_SCENARIO,
  PROVIDER_CANARY_PROFILES,
  buildProviderCanarySummary,
  validateProviderCanaryInput,
  validateSanitizedProviderCanarySummary,
} from './evals/provider-canary/contracts.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const scenariosPath = resolve(
  repoRoot,
  'tooling/evals/provider-canary/scenarios-v1.json',
);
const QWEN_AUDIO_FLASH_PROFILE =
  'dashscope-qwen-audio-3-tts-flash-longanhuan-v3-6-pcm24k';

describe('protected Provider canary contract', () => {
  it('accepts the frozen input within the five-scenario/two-turn budget', () => {
    const input = validateProviderCanaryInput(
      JSON.parse(readFileSync(scenariosPath, 'utf8')),
    );
    assert.ok(input.scenarios.length <= MAX_PROVIDER_CANARY_SCENARIOS);
    assert.equal(input.turnsPerScenario, MAX_PROVIDER_TURNS_PER_SCENARIO);
  });

  it('rejects budget overflow and duplicate scenario identities', () => {
    const scenarios = Array.from(
      { length: MAX_PROVIDER_CANARY_SCENARIOS + 1 },
      (_, index) => ({ id: `scenario-${index}`, text: '冻结合成句子' }),
    );
    assert.throws(
      () =>
        validateProviderCanaryInput({
          schemaVersion: 1,
          datasetVersion: 'v1',
          turnsPerScenario: 2,
          scenarios,
        }),
      /budget/,
    );
    assert.throws(
      () =>
        validateProviderCanaryInput({
          schemaVersion: 1,
          datasetVersion: 'v1',
          turnsPerScenario: 2,
          scenarios: [
            { id: 'same', text: '第一句' },
            { id: 'same', text: '第二句' },
          ],
        }),
      /invalid/,
    );
  });

  it('emits only aggregate SHA-bound evidence and rejects sensitive fields', () => {
    const summary = buildProviderCanarySummary({
      sha: 'a'.repeat(40),
      providerProfile: QWEN_AUDIO_FLASH_PROFILE,
      datasetVersion: 'live-voice-provider-v1',
      turnsPerScenario: 2,
      results: [
        {
          id: 'passing',
          status: 'passed',
          latencyMs: 120,
          roundTripSimilarity: 0.9,
          stableErrorCode: null,
        },
        {
          id: 'failing',
          status: 'failed',
          latencyMs: 240,
          roundTripSimilarity: 0,
          stableErrorCode: 'ASR_MODEL_FAILED',
        },
      ],
      generatedAt: '2026-08-11T00:00:00.000Z',
    });
    assert.equal(summary.successRate, 0.5);
    assert.equal(summary.turnCount, 4);
    assert.deepEqual(summary.latencyMs, { p50: 120, p95: 240 });
    assert.deepEqual(summary.stableErrors, [
      { code: 'ASR_MODEL_FAILED', count: 1 },
    ]);
    assert.equal(validateSanitizedProviderCanarySummary(summary), true);
    assert.throws(
      () =>
        validateSanitizedProviderCanarySummary({
          ...summary,
          rawTranscript: 'synthetic text',
        }),
      /forbidden field/,
    );
    assert.throws(
      () =>
        validateSanitizedProviderCanarySummary({
          ...summary,
          note: `Bearer ${'x'.repeat(20)}`,
        }),
      /secret-like text/,
    );
  });

  it('binds evidence to a closed, non-sensitive TTS profile identity', () => {
    const input = {
      sha: 'a'.repeat(40),
      datasetVersion: 'live-voice-provider-v1',
      turnsPerScenario: 2,
      results: [
        {
          id: 'passing',
          status: 'passed',
          latencyMs: 120,
          roundTripSimilarity: 0.9,
          stableErrorCode: null,
        },
      ],
      generatedAt: '2026-08-12T00:00:00.000Z',
    };
    const summary = buildProviderCanarySummary({
      ...input,
      providerProfile: QWEN_AUDIO_FLASH_PROFILE,
    });
    assert.equal(summary.providerProfile, QWEN_AUDIO_FLASH_PROFILE);
    assert.ok(PROVIDER_CANARY_PROFILES.includes(QWEN_AUDIO_FLASH_PROFILE));
    assert.throws(
      () =>
        buildProviderCanarySummary({
          ...input,
          providerProfile: 'unregistered-provider-profile',
        }),
      /profile/,
    );
  });

  it('is manual-only, environment-protected, bounded, and uploads only summary JSON', () => {
    const workflow = readFileSync(
      resolve(repoRoot, '.github/workflows/provider-canary.yml'),
      'utf8',
    );
    assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/m);
    assert.doesNotMatch(workflow, /^\s{2}(?:pull_request|push|schedule):/m);
    assert.match(workflow, /^\s{4}environment: provider-canary$/m);
    assert.match(workflow, /^\s{4}timeout-minutes: 10$/m);
    assert.equal(workflow.match(/\$\{\{ secrets\./g)?.length, 2);
    assert.match(workflow, /run: pnpm provider:canary/);
    assert.match(workflow, /path: output\/provider-canary\/summary\.json/);
    assert.doesNotMatch(workflow, /path: output\/provider-canary\s*$/m);
  });
});
