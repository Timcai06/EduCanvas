export interface LivePerformanceBudgets {
  readonly deltaToChatSubmitP95Ms: number;
  readonly readableBoundaryToTtsSubmitP95Ms: number;
  readonly firstPcmToPlaybackScheduleP95Ms: number;
  readonly continuousSegmentGapP95Ms: number;
  readonly interruptionToLocalSilenceP95Ms: number;
  readonly interruptionToCancelP95Ms: number;
}

export const LC08_BUDGET_DEFAULTS: Readonly<{
  source: string;
  values: LivePerformanceBudgets;
}> = Object.freeze({
  source:
    'docs/plan/active/LC-Live与Canvas输出产品化.md (performance table automatic blocking targets)',
  values: {
    deltaToChatSubmitP95Ms: 100,
    readableBoundaryToTtsSubmitP95Ms: 300,
    firstPcmToPlaybackScheduleP95Ms: 120,
    continuousSegmentGapP95Ms: 120,
    interruptionToLocalSilenceP95Ms: 120,
    interruptionToCancelP95Ms: 150,
  },
});

const BUDGET_ENV = {
  deltaToChatSubmitP95Ms: 'LC08_BUDGET_DELTA_TO_CHAT_SUBMIT_P95_MS',
  readableBoundaryToTtsSubmitP95Ms: 'LC08_BUDGET_BOUNDARY_TO_TTS_SUBMIT_P95_MS',
  firstPcmToPlaybackScheduleP95Ms: 'LC08_BUDGET_FIRST_PCM_TO_PLAYBACK_P95_MS',
  continuousSegmentGapP95Ms: 'LC08_BUDGET_CONTINUOUS_SEGMENT_GAP_P95_MS',
  interruptionToLocalSilenceP95Ms: 'LC08_BUDGET_INTERRUPTION_TO_SILENCE_P95_MS',
  interruptionToCancelP95Ms: 'LC08_BUDGET_INTERRUPTION_TO_CANCEL_P95_MS',
} as const;

function parseBudgetValue(raw: string | undefined): number | null {
  if (raw == null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function resolveLivePerformanceBudgets(
  overrides: Partial<LivePerformanceBudgets> = {},
  env: Record<string, string | undefined> = process.env,
): LivePerformanceBudgets {
  return {
    deltaToChatSubmitP95Ms:
      parseBudgetValue(env[BUDGET_ENV.deltaToChatSubmitP95Ms]) ??
      LC08_BUDGET_DEFAULTS.values.deltaToChatSubmitP95Ms,
    readableBoundaryToTtsSubmitP95Ms:
      parseBudgetValue(env[BUDGET_ENV.readableBoundaryToTtsSubmitP95Ms]) ??
      LC08_BUDGET_DEFAULTS.values.readableBoundaryToTtsSubmitP95Ms,
    firstPcmToPlaybackScheduleP95Ms:
      parseBudgetValue(env[BUDGET_ENV.firstPcmToPlaybackScheduleP95Ms]) ??
      LC08_BUDGET_DEFAULTS.values.firstPcmToPlaybackScheduleP95Ms,
    continuousSegmentGapP95Ms:
      parseBudgetValue(env[BUDGET_ENV.continuousSegmentGapP95Ms]) ??
      LC08_BUDGET_DEFAULTS.values.continuousSegmentGapP95Ms,
    interruptionToLocalSilenceP95Ms:
      parseBudgetValue(env[BUDGET_ENV.interruptionToLocalSilenceP95Ms]) ??
      LC08_BUDGET_DEFAULTS.values.interruptionToLocalSilenceP95Ms,
    interruptionToCancelP95Ms:
      parseBudgetValue(env[BUDGET_ENV.interruptionToCancelP95Ms]) ??
      LC08_BUDGET_DEFAULTS.values.interruptionToCancelP95Ms,
    ...overrides,
  };
}
