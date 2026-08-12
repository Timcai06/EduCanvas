import { describe, expect, it } from 'vitest';
import {
  createTeachingTurnState,
  teachingTurnReducer,
} from '@/features/chat/turn-state';
import { LiveInterruptionCoordinator } from '../live-interruption-coordinator';
import { takeSemanticSpeechSegments } from '../playback/semantic-segmentation';
import { streamSpeechIntoPlayer } from '../playback/stream-speech-into-player';
import {
  FakeMonotonicClock,
  LivePerformanceHarness,
} from './live-performance-harness';

/** L08：用真实 reducer/segmenter/PCM mapper/cancel coordinator 驱动 fake 时钟。 */
describe('Live fake pipeline performance gate', () => {
  it('把实际 Live 纯路径的 marker 接入六项预算，而非只测试计数器本身', async () => {
    const clock = new FakeMonotonicClock();
    const performance = new LivePerformanceHarness({ clock });

    let turn = teachingTurnReducer(createTeachingTurnState([]), {
      type: 'send.started',
      clientMessageId: 'client-1',
      text: '请解释。',
    });
    turn = teachingTurnReducer(turn, {
      type: 'stream.event',
      event: {
        type: 'turn.accepted',
        schemaVersion: '1',
        turnId: 'turn-1',
        studentMessageId: 'student-1',
        assistantMessageId: 'assistant-1',
        replayed: false,
      },
    });
    performance.recordSseDelta();
    clock.advance(20);
    turn = teachingTurnReducer(turn, {
      type: 'stream.event',
      event: {
        type: 'message.delta',
        schemaVersion: '1',
        turnId: 'turn-1',
        messageId: 'assistant-1',
        delta: '这是第一句。',
      },
    });
    performance.recordChatSubmit();
    expect(turn.messages.at(-1)?.text).toBe('这是第一句。');

    performance.recordReadableBoundary();
    const batch = takeSemanticSpeechSegments({
      text: '这是第一句。',
      consumedCharacters: 0,
      segmentCount: 0,
      complete: false,
      nowMs: clock.nowMs(),
      waitingSinceMs: clock.nowMs(),
    });
    expect(batch.segments).toHaveLength(1);
    clock.advance(40);
    performance.recordTtsSubmit();

    const windows = [
      { startAt: 1, endAt: 1.5, durationSeconds: 0.5 },
      { startAt: 1.55, endAt: 2, durationSeconds: 0.45 },
    ];
    let pcmSequence = 0;
    await streamSpeechIntoPlayer({
      text: batch.segments[0]!.text,
      signal: new AbortController().signal,
      player: {
        enqueue: async () => {
          const segmentId = `pcm-${pcmSequence}`;
          const window = windows[pcmSequence++]!;
          performance.recordFirstPcm({ runId: 'run-1', segmentId });
          clock.advance(8);
          performance.recordPlaybackSchedule({
            runId: 'run-1',
            segmentId,
            playbackStartAtMs: window.startAt * 1_000,
            playbackEndAtMs: window.endAt * 1_000,
          });
          return window;
        },
      },
      cues: [],
      onMarker: () => undefined,
      onSubtitle: () => undefined,
      fetchImpl: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(Uint8Array.of(1, 2));
              controller.enqueue(Uint8Array.of(3, 4));
              controller.close();
            },
          }),
          { status: 200 },
        ),
    });

    const interruption = new LiveInterruptionCoordinator<object>();
    interruption.setBusy({ busy: true, turnId: 'client-1' });
    performance.recordInterruption();
    const decisions = interruption.onBargeIn();
    performance.recordLocalSilence();
    clock.advance(10);
    expect(decisions).toEqual([{ type: 'cancel-agent', turnId: 'client-1' }]);
    performance.recordCancelEmit();

    expect(performance.assertWithinBudgets()).toEqual({
      passed: true,
      breaches: [],
      missingMetrics: [],
    });
  });
});
