import {
  LC08_BUDGET_DEFAULTS,
  resolveLivePerformanceBudgets,
  type LivePerformanceBudgets,
} from './live-performance-budgets';

export interface MonotonicClock {
  nowMs(): number;
}

export interface MutableMonotonicClock extends MonotonicClock {
  advance(ms: number): void;
}

export class FakeMonotonicClock implements MutableMonotonicClock {
  constructor(private currentMs = 0) {}

  nowMs(): number {
    return this.currentMs;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new Error('Monotonic clock cannot advance backward');
    }
    this.currentMs += ms;
  }
}

export interface SegmentMarker {
  readonly runId: string;
  readonly segmentId: string;
  /** Web Audio 单调时间轴上的排期窗口；用于测真实静音间隙。 */
  readonly playbackStartAtMs?: number;
  readonly playbackEndAtMs?: number;
}

interface RunState {
  readonly pendingSseDeltas: number[];
  readonly pendingReadableBoundaries: number[];
  readonly pendingInterruptions: {
    readonly localSilence: number[];
    readonly cancel: number[];
  };
  readonly firstPcmBySegment: Map<string, number>;
  lastPlaybackEndAtMs: number | null;
}

export interface LivePerformanceSample {
  readonly metric: string;
  readonly sampleCount: number;
  readonly p95Ms: number | null;
  readonly maxMs: number | null;
  readonly budgetMs: number;
  readonly pass: boolean;
}

interface MetricState {
  readonly values: number[];
  budgetMs: number;
}

export interface LivePerformanceReport {
  readonly defaultRunId: string;
  readonly sampleBudgetSource: string;
  readonly samplesByMetric: {
    readonly deltaToChatSubmit: LivePerformanceSample;
    readonly readableBoundaryToTtsSubmit: LivePerformanceSample;
    readonly firstPcmToPlaybackSchedule: LivePerformanceSample;
    readonly continuousSegmentGap: LivePerformanceSample;
    readonly interruptionToLocalSilence: LivePerformanceSample;
    readonly interruptionToCancel: LivePerformanceSample;
  };
}

export interface LivePerformanceHarnessOptions {
  readonly clock: MonotonicClock;
  readonly budgets?: Partial<LivePerformanceBudgets>;
  readonly sourceEnv?: Record<string, string | undefined>;
}

export interface Breach {
  readonly metric: keyof LivePerformanceReport['samplesByMetric'];
  readonly thresholdMs: number;
  readonly actualP95Ms: number;
}

const DEFAULT_RUN_ID = 'run-1';

function createRunState(): RunState {
  return {
    pendingSseDeltas: [],
    pendingReadableBoundaries: [],
    pendingInterruptions: {
      localSilence: [],
      cancel: [],
    },
    firstPcmBySegment: new Map(),
    lastPlaybackEndAtMs: null,
  };
}

function calculateP95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(values.length * 0.95) - 1;
  return sorted[Math.max(0, index)]!;
}

export class LivePerformanceHarness {
  private readonly clock: MonotonicClock;
  private readonly budgets: LivePerformanceBudgets;
  private readonly runs = new Map<string, RunState>();
  private readonly defaultRunId: string;

  private readonly deltaToChatSubmit: MetricState = {
    values: [],
    budgetMs: 0,
  };
  private readonly boundaryToTtsSubmit: MetricState = {
    values: [],
    budgetMs: 0,
  };
  private readonly firstPcmToSchedule: MetricState = {
    values: [],
    budgetMs: 0,
  };
  private readonly continuousGap: MetricState = {
    values: [],
    budgetMs: 0,
  };
  private readonly interruptionToSilence: MetricState = {
    values: [],
    budgetMs: 0,
  };
  private readonly interruptionToCancel: MetricState = {
    values: [],
    budgetMs: 0,
  };

  constructor({ clock, budgets, sourceEnv }: LivePerformanceHarnessOptions) {
    this.clock = clock;
    this.budgets = resolveLivePerformanceBudgets(
      budgets,
      sourceEnv ?? process.env,
    );
    this.defaultRunId = DEFAULT_RUN_ID;
    this.deltaToChatSubmit.budgetMs = this.budgets.deltaToChatSubmitP95Ms;
    this.boundaryToTtsSubmit.budgetMs =
      this.budgets.readableBoundaryToTtsSubmitP95Ms;
    this.firstPcmToSchedule.budgetMs =
      this.budgets.firstPcmToPlaybackScheduleP95Ms;
    this.continuousGap.budgetMs = this.budgets.continuousSegmentGapP95Ms;
    this.interruptionToSilence.budgetMs =
      this.budgets.interruptionToLocalSilenceP95Ms;
    this.interruptionToCancel.budgetMs = this.budgets.interruptionToCancelP95Ms;
  }

  private run(runId = this.defaultRunId): RunState {
    if (!this.runs.has(runId)) this.runs.set(runId, createRunState());
    return this.runs.get(runId)!;
  }

  recordSseDelta(runId = this.defaultRunId): void {
    const run = this.run(runId);
    run.pendingSseDeltas.push(this.clock.nowMs());
  }

  recordReadableBoundary(runId = this.defaultRunId): void {
    const run = this.run(runId);
    run.pendingReadableBoundaries.push(this.clock.nowMs());
  }

  recordChatSubmit(runId = this.defaultRunId): void {
    const run = this.run(runId);
    const deltaAt = run.pendingSseDeltas.shift();
    if (deltaAt == null) return;
    this.deltaToChatSubmit.values.push(this.clock.nowMs() - deltaAt);
  }

  recordTtsSubmit(runId = this.defaultRunId): void {
    const run = this.run(runId);
    const boundaryAt = run.pendingReadableBoundaries.shift();
    if (boundaryAt == null) return;
    this.boundaryToTtsSubmit.values.push(this.clock.nowMs() - boundaryAt);
  }

  recordFirstPcm(marker: SegmentMarker): void {
    const run = this.run(marker.runId);
    run.firstPcmBySegment.set(marker.segmentId, this.clock.nowMs());
  }

  recordPlaybackSchedule(marker: SegmentMarker): void {
    const run = this.run(marker.runId);
    const pcmAt = run.firstPcmBySegment.get(marker.segmentId);
    if (pcmAt == null) return;
    this.firstPcmToSchedule.values.push(this.clock.nowMs() - pcmAt);
    run.firstPcmBySegment.delete(marker.segmentId);

    if (run.lastPlaybackEndAtMs != null && marker.playbackStartAtMs != null) {
      this.continuousGap.values.push(
        Math.max(0, marker.playbackStartAtMs - run.lastPlaybackEndAtMs),
      );
    }
    if (marker.playbackEndAtMs != null) {
      run.lastPlaybackEndAtMs = marker.playbackEndAtMs;
    }
  }

  recordInterruption(runId = this.defaultRunId): void {
    const run = this.run(runId);
    run.pendingInterruptions.localSilence.push(this.clock.nowMs());
    run.pendingInterruptions.cancel.push(this.clock.nowMs());
  }

  recordLocalSilence(runId = this.defaultRunId): void {
    const run = this.run(runId);
    const interruptionAt = run.pendingInterruptions.localSilence.shift();
    if (interruptionAt == null) return;
    this.interruptionToSilence.values.push(this.clock.nowMs() - interruptionAt);
  }

  recordCancelEmit(runId = this.defaultRunId): void {
    const run = this.run(runId);
    const interruptionAt = run.pendingInterruptions.cancel.shift();
    if (interruptionAt == null) return;
    this.interruptionToCancel.values.push(this.clock.nowMs() - interruptionAt);
  }

  evaluate(): LivePerformanceReport {
    return {
      defaultRunId: this.defaultRunId,
      sampleBudgetSource: this.sampleBudgetSource(),
      samplesByMetric: {
        deltaToChatSubmit: this.buildSample(
          'deltaToChatSubmit',
          this.deltaToChatSubmit,
        ),
        readableBoundaryToTtsSubmit: this.buildSample(
          'readableBoundaryToTtsSubmit',
          this.boundaryToTtsSubmit,
        ),
        firstPcmToPlaybackSchedule: this.buildSample(
          'firstPcmToPlaybackSchedule',
          this.firstPcmToSchedule,
        ),
        continuousSegmentGap: this.buildSample(
          'continuousSegmentGap',
          this.continuousGap,
        ),
        interruptionToLocalSilence: this.buildSample(
          'interruptionToLocalSilence',
          this.interruptionToSilence,
        ),
        interruptionToCancel: this.buildSample(
          'interruptionToCancel',
          this.interruptionToCancel,
        ),
      },
    };
  }

  assertWithinBudgets(): {
    passed: boolean;
    breaches: Breach[];
    missingMetrics: Array<keyof LivePerformanceReport['samplesByMetric']>;
  } {
    const report = this.evaluate();
    const breaches: Breach[] = [];
    const missingMetrics: Array<
      keyof LivePerformanceReport['samplesByMetric']
    > = [];
    for (const metric of Object.keys(report.samplesByMetric) as Array<
      keyof LivePerformanceReport['samplesByMetric']
    >) {
      const sample = report.samplesByMetric[metric];
      if (sample.p95Ms == null) {
        missingMetrics.push(metric);
        continue;
      }
      if (sample.pass) continue;
      breaches.push({
        metric,
        thresholdMs: sample.budgetMs,
        actualP95Ms: sample.p95Ms,
      });
    }
    return {
      passed: breaches.length === 0 && missingMetrics.length === 0,
      breaches,
      missingMetrics,
    };
  }

  private buildSample(
    label: string,
    metricState: MetricState,
  ): LivePerformanceSample {
    const p95 = calculateP95(metricState.values);
    const max =
      metricState.values.length === 0 ? null : Math.max(...metricState.values);
    return {
      metric: label,
      sampleCount: metricState.values.length,
      p95Ms: p95,
      maxMs: max,
      budgetMs: metricState.budgetMs,
      pass: p95 == null || p95 <= metricState.budgetMs,
    };
  }

  private sampleBudgetSource() {
    return LC08_BUDGET_DEFAULTS.source;
  }
}
