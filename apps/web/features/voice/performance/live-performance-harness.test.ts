import { describe, expect, it } from 'vitest';
import {
  LC08_BUDGET_DEFAULTS,
  resolveLivePerformanceBudgets,
} from './live-performance-budgets';
import {
  FakeMonotonicClock,
  LivePerformanceHarness,
} from './live-performance-harness';

describe('Live 性能 fact-check harness', () => {
  it('在假 SSE/TTS/PCM 标记链路下测量 p95 并对齐计划预算', () => {
    const clock = new FakeMonotonicClock(0);
    const harness = new LivePerformanceHarness({
      clock,
      budgets: {
        deltaToChatSubmitP95Ms: 100,
        readableBoundaryToTtsSubmitP95Ms: 300,
        firstPcmToPlaybackScheduleP95Ms: 120,
        continuousSegmentGapP95Ms: 120,
        interruptionToLocalSilenceP95Ms: 120,
        interruptionToCancelP95Ms: 150,
      },
    });

    harness.recordSseDelta();
    clock.advance(50);
    harness.recordChatSubmit();
    clock.advance(50);
    harness.recordReadableBoundary();
    clock.advance(180);
    harness.recordTtsSubmit();
    clock.advance(20);
    harness.recordFirstPcm({ runId: 'run-1', segmentId: 'seg-1' });
    clock.advance(100);
    harness.recordPlaybackSchedule({
      runId: 'run-1',
      segmentId: 'seg-1',
      playbackStartAtMs: 1_000,
      playbackEndAtMs: 1_600,
    });
    clock.advance(30);
    harness.recordFirstPcm({ runId: 'run-1', segmentId: 'seg-2' });
    clock.advance(90);
    harness.recordPlaybackSchedule({
      runId: 'run-1',
      segmentId: 'seg-2',
      playbackStartAtMs: 1_720,
      playbackEndAtMs: 2_100,
    });
    clock.advance(60);
    harness.recordInterruption();
    clock.advance(40);
    harness.recordLocalSilence();
    clock.advance(40);
    harness.recordCancelEmit();

    const report = harness.evaluate();
    expect(report.defaultRunId).toBe('run-1');
    expect(report.sampleBudgetSource).toBe(LC08_BUDGET_DEFAULTS.source);
    expect(report.samplesByMetric.deltaToChatSubmit.p95Ms).toBe(50);
    expect(report.samplesByMetric.readableBoundaryToTtsSubmit.p95Ms).toBe(180);
    expect(report.samplesByMetric.firstPcmToPlaybackSchedule.p95Ms).toBe(100);
    expect(report.samplesByMetric.continuousSegmentGap.p95Ms).toBe(120);
    expect(report.samplesByMetric.interruptionToLocalSilence.p95Ms).toBe(40);
    expect(report.samplesByMetric.interruptionToCancel.p95Ms).toBe(80);
    expect(harness.assertWithinBudgets().passed).toBe(true);
  });

  it('预算可配置且可以阻断超阈值场景', () => {
    const clock = new FakeMonotonicClock(0);
    const harness = new LivePerformanceHarness({
      clock,
      budgets: {
        deltaToChatSubmitP95Ms: 40,
        readableBoundaryToTtsSubmitP95Ms: 100,
        firstPcmToPlaybackScheduleP95Ms: 80,
        continuousSegmentGapP95Ms: 50,
        interruptionToLocalSilenceP95Ms: 20,
        interruptionToCancelP95Ms: 30,
      },
    });

    harness.recordSseDelta();
    clock.advance(60);
    harness.recordChatSubmit();
    harness.recordReadableBoundary();
    clock.advance(120);
    harness.recordTtsSubmit();
    harness.recordFirstPcm({ runId: 'run-2', segmentId: 'seg-1' });
    clock.advance(95);
    harness.recordPlaybackSchedule({
      runId: 'run-2',
      segmentId: 'seg-1',
      playbackStartAtMs: 1_000,
      playbackEndAtMs: 1_500,
    });
    clock.advance(10);
    harness.recordFirstPcm({ runId: 'run-2', segmentId: 'seg-2' });
    clock.advance(95);
    harness.recordPlaybackSchedule({
      runId: 'run-2',
      segmentId: 'seg-2',
      playbackStartAtMs: 1_560,
      playbackEndAtMs: 2_000,
    });
    harness.recordInterruption('run-2');
    clock.advance(25);
    harness.recordLocalSilence('run-2');
    clock.advance(35);
    harness.recordCancelEmit('run-2');

    const result = harness.assertWithinBudgets();
    expect(result.passed).toBe(false);
    const breached = result.breaches.map((item) => item.metric).sort();
    expect(breached).toContain('continuousSegmentGap');
    expect(breached).toContain('deltaToChatSubmit');
    expect(breached).toContain('interruptionToLocalSilence');
    expect(breached).toContain('interruptionToCancel');
    expect(breached).toContain('firstPcmToPlaybackSchedule');
    expect(breached).toContain('readableBoundaryToTtsSubmit');
  });

  it('支持通过环境变量/显式覆盖预算（未配置时使用计划默认值）', () => {
    const fromEnv = resolveLivePerformanceBudgets(
      {},
      {
        LC08_BUDGET_DELTA_TO_CHAT_SUBMIT_P95_MS: '77',
        LC08_BUDGET_INTERRUPTION_TO_CANCEL_P95_MS: '66',
      },
    );
    expect(fromEnv.deltaToChatSubmitP95Ms).toBe(77);
    expect(fromEnv.interruptionToCancelP95Ms).toBe(66);
    expect(fromEnv.readableBoundaryToTtsSubmitP95Ms).toBe(
      LC08_BUDGET_DEFAULTS.values.readableBoundaryToTtsSubmitP95Ms,
    );
  });

  it('缺少任一指标样本时 fail closed，不把空报告当作性能通过', () => {
    const harness = new LivePerformanceHarness({
      clock: new FakeMonotonicClock(),
    });
    const result = harness.assertWithinBudgets();
    expect(result.passed).toBe(false);
    expect(result.missingMetrics).toHaveLength(6);
  });
});
