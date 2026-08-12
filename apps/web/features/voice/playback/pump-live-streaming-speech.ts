import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
  LiveSpeechSessionClient,
  StreamingSpeechClientHandlers,
} from '../transport';
import { reduceLiveSpeechCursors } from './live-speech-cursors';
import type { LiveSpeechPlaybackAction } from './live-speech-playback-state';
import type { LiveSpeechQueueState } from './live-speech-queue';
import { LiveStreamingSpeechPlayback } from './live-streaming-speech-playback';
import { Pcm16Player } from './pcm-player';
import type { SubtitleDurationClock } from './subtitle-clock/recovery';

interface PumpLiveStreamingSpeechOptions {
  readonly notebookId: string;
  readonly createSpeechClient: (
    handlers: StreamingSpeechClientHandlers,
  ) => LiveSpeechSessionClient;
  readonly queueRef: MutableRefObject<LiveSpeechQueueState>;
  readonly enabledRef: MutableRefObject<boolean>;
  readonly playerRef: MutableRefObject<Pcm16Player | null>;
  readonly abortControllerRef: MutableRefObject<AbortController | null>;
  readonly markerCancelsRef: MutableRefObject<Array<() => void>>;
  readonly streamingPlaybackRef: MutableRefObject<LiveStreamingSpeechPlayback | null>;
  readonly streamingSegmentsRef: MutableRefObject<
    LiveSpeechQueueState['queue']
  >;
  readonly forceHttpRef: MutableRefObject<boolean>;
  readonly requestPump: () => void;
  readonly dispatch: Dispatch<LiveSpeechPlaybackAction>;
  readonly setOutputLevel: Dispatch<SetStateAction<number>>;
  readonly finishWhenPlaybackEnds: (runId: number) => void;
  readonly durationClock: SubtitleDurationClock;
}

/** 启动或继续当前 Assistant response 的单一 TTS session。 */
export function pumpLiveStreamingSpeech(
  options: PumpLiveStreamingSpeechOptions,
): void {
  const queue = options.queueRef.current;
  if (queue.pumping || queue.suppressed || !options.enabledRef.current) return;
  queue.pumping = true;
  const runId = queue.cursor.runId;
  options.playerRef.current ??= new Pcm16Player();
  const player = options.playerRef.current;
  void (async () => {
    try {
      if (!options.streamingPlaybackRef.current) {
        options.dispatch({ type: 'prepare' });
        const controller = new AbortController();
        options.abortControllerRef.current = controller;
        const playback = new LiveStreamingSpeechPlayback({
          notebookId: options.notebookId,
          player,
          signal: controller.signal,
          createClient: options.createSpeechClient,
          durationClock: options.durationClock,
          onMarker: (at, callback) => {
            options.markerCancelsRef.current.push(
              player.scheduleMarker(at, callback),
            );
          },
          onSubtitle: (text) => {
            if (options.queueRef.current.cursor.runId === runId) {
              options.dispatch({ type: 'cue', text });
            }
          },
          onPlayedCursor: (endCursor) => {
            const current = options.queueRef.current;
            const assistantId = current.cursor.assistantId;
            if (!assistantId || current.cursor.runId !== runId) return;
            current.cursor = reduceLiveSpeechCursors(current.cursor, {
              type: 'played',
              assistantId,
              runId,
              endCursor,
            });
          },
          onFirstAudio: () => {
            if (options.queueRef.current.cursor.runId === runId) {
              options.dispatch({ type: 'start' });
            }
          },
          onAudioLevel: (level) => {
            if (options.queueRef.current.cursor.runId === runId) {
              options.setOutputLevel(level);
            }
          },
          onFinished: (lastWindow) => {
            if (options.queueRef.current.cursor.runId !== runId) return;
            options.streamingPlaybackRef.current = null;
            options.streamingSegmentsRef.current = [];
            options.abortControllerRef.current = null;
            options.queueRef.current.lastWindow = lastWindow;
            options.queueRef.current.pumping = false;
            if (options.queueRef.current.queue.length > 0) {
              queueMicrotask(options.requestPump);
            } else {
              options.finishWhenPlaybackEnds(runId);
            }
          },
          onFailed: (beforeFirstAudio) => {
            if (options.queueRef.current.cursor.runId !== runId) return;
            options.streamingPlaybackRef.current = null;
            options.abortControllerRef.current = null;
            options.queueRef.current.pumping = false;
            if (beforeFirstAudio) {
              options.forceHttpRef.current = true;
              options.queueRef.current.queue.unshift(
                ...options.streamingSegmentsRef.current,
              );
              options.streamingSegmentsRef.current = [];
              queueMicrotask(options.requestPump);
              return;
            }
            options.streamingSegmentsRef.current = [];
            /* 已听到的 segment 不能重放，否则会重复；但也不能永久 suppress
               整个 Assistant response。后续尚未提交或新到达的 delta 切到
               逐段 HTTP，下一段 prepare 会清除暂时失败状态。 */
            options.forceHttpRef.current = true;
            options.markerCancelsRef.current
              .splice(0)
              .forEach((cancel) => cancel());
            player.stop();
            options.dispatch({ type: 'fail' });
            options.setOutputLevel(0);
            if (options.queueRef.current.queue.length > 0) {
              queueMicrotask(options.requestPump);
            }
          },
        });
        options.streamingPlaybackRef.current = playback;
        try {
          await playback.start();
        } catch (error: unknown) {
          if (options.queueRef.current.cursor.runId !== runId) return;
          options.streamingPlaybackRef.current = null;
          options.abortControllerRef.current = null;
          if (error instanceof DOMException && error.name === 'AbortError') {
            options.dispatch({ type: 'interrupt' });
            return;
          }
          options.forceHttpRef.current = true;
        }
      }
      if (options.forceHttpRef.current) return;
      const playback = options.streamingPlaybackRef.current;
      if (!playback || options.queueRef.current.cursor.runId !== runId) return;
      while (options.queueRef.current.queue.length > 0) {
        const segment = options.queueRef.current.queue[0]!;
        /* Provider 空闲窗口主动 finish 后，迟到 delta 必须留在公共队列，等
           task-finished 再开启下一段 burst；不能 shift 后静默丢字。 */
        if (!playback.submit(segment)) break;
        options.queueRef.current.queue.shift();
        options.streamingSegmentsRef.current.push(segment);
      }
      if (options.queueRef.current.complete) playback.finish();
    } catch {
      if (options.queueRef.current.cursor.runId !== runId) return;
      const playback = options.streamingPlaybackRef.current;
      options.streamingPlaybackRef.current = null;
      playback?.cancel();
      if (!playback?.hasHeardAudio()) {
        options.forceHttpRef.current = true;
        options.queueRef.current.queue.unshift(
          ...options.streamingSegmentsRef.current,
        );
      } else {
        options.forceHttpRef.current = true;
        options.markerCancelsRef.current
          .splice(0)
          .forEach((cancel) => cancel());
        player.stop();
        options.dispatch({ type: 'fail' });
        options.setOutputLevel(0);
      }
      options.streamingSegmentsRef.current = [];
    } finally {
      if (options.queueRef.current.cursor.runId !== runId) return;
      options.queueRef.current.pumping = false;
      if (
        options.forceHttpRef.current &&
        options.queueRef.current.queue.length > 0
      ) {
        queueMicrotask(options.requestPump);
      }
    }
  })();
}
