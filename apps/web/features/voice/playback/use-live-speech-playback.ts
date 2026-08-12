'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ChatMessageStatus } from '@/features/chat/messages';
import { Pcm16Player } from './pcm-player';
import {
  createLiveSubtitleCues,
  prepareLiveSpeechText,
} from './live-speech-text';
import { takeSemanticSpeechSegments } from './semantic-segmentation';
import {
  createLiveSpeechQueueState,
  type LiveSpeechQueueState,
} from './live-speech-queue';
import { LiveSpeechResponseGate } from './live-speech-response-gate';
import {
  nextLiveSpeechSourceCursor,
  reduceLiveSpeechCursors,
} from './live-speech-cursors';
import { streamSpeechIntoPlayer } from './stream-speech-into-player';
import { useSemanticSegmentationRetry } from './use-semantic-segmentation-retry';

export {
  streamSpeechIntoPlayer,
  type LiveSpeechPcmPlayer,
} from './stream-speech-into-player';

export interface UseLiveSpeechPlaybackOptions {
  readonly enabled: boolean;
  /** clientMessageId 在 local → accepted 消息替换期间保持稳定，不能使用 message.id。 */
  readonly assistantId: string | null;
  readonly assistantText: string | null;
  readonly assistantStatus?: ChatMessageStatus | null;
}

export interface LiveSpeechPlaybackState {
  readonly speaking: boolean;
  readonly preparing: boolean;
  readonly subtitle: string | null;
  readonly outputLevel: number;
  readonly playbackFailed: boolean;
  readonly prepare: () => void;
  /** 用户语音 final 后调用：只允许随后产生的新 Assistant 进入 TTS。 */
  readonly expectNextResponse: () => void;
  readonly cancelPending: () => void;
  readonly interrupt: () => void;
}

export interface LiveSpeechPlaybackViewState {
  readonly phase: 'idle' | 'preparing' | 'speaking';
  readonly subtitle: string | null;
  readonly playbackFailed: boolean;
}

export type LiveSpeechPlaybackAction =
  | { readonly type: 'prepare' }
  | { readonly type: 'start' }
  | { readonly type: 'cue'; readonly text: string }
  | { readonly type: 'finish' | 'interrupt' }
  | { readonly type: 'fail' };

const INITIAL_PLAYBACK_STATE: LiveSpeechPlaybackViewState = {
  phase: 'idle',
  subtitle: null,
  playbackFailed: false,
};

/** 播放终态必须原子清空字幕，避免最后一个 cue 泄漏到下一轮聆听状态。 */
export function reduceLiveSpeechPlayback(
  state: LiveSpeechPlaybackViewState,
  action: LiveSpeechPlaybackAction,
): LiveSpeechPlaybackViewState {
  if (action.type === 'prepare') {
    /* 下一语义段可以在上一段仍播放时预取，状态与字幕不能倒退成“准备中”。 */
    if (state.phase === 'speaking') {
      return { ...state, playbackFailed: false };
    }
    return { phase: 'preparing', subtitle: null, playbackFailed: false };
  }
  if (action.type === 'start') {
    return {
      phase: 'speaking',
      subtitle: state.subtitle,
      playbackFailed: false,
    };
  }
  if (action.type === 'cue') {
    return state.phase === 'speaking'
      ? { ...state, subtitle: action.text }
      : state;
  }
  if (action.type === 'fail') {
    return { phase: 'idle', subtitle: null, playbackFailed: true };
  }
  return { ...state, phase: 'idle', subtitle: null };
}

/**
 * Assistant 的安全 message.delta 到达后立即分段播报。当前 HTTP 路由保持兼容，
 * 语义段按顺序预取并进入同一 Web Audio 队列；后端升级为长连接 Speech Session
 * 时只需替换 `streamSpeechIntoPlayer` 的 transport，不改变字幕与播放状态机。
 */
export function useLiveSpeechPlayback({
  enabled,
  assistantId,
  assistantText,
  assistantStatus = null,
}: UseLiveSpeechPlaybackOptions): LiveSpeechPlaybackState {
  const [viewState, dispatch] = useReducer(
    reduceLiveSpeechPlayback,
    INITIAL_PLAYBACK_STATE,
  );
  const [outputLevel, setOutputLevel] = useState(0);
  const playerRef = useRef<Pcm16Player | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const markerCancelsRef = useRef<Array<() => void>>([]);
  const finishMarkerCancelRef = useRef<(() => void) | null>(null);
  const queueRef = useRef<LiveSpeechQueueState>(createLiveSpeechQueueState());
  const {
    revision: segmentationRevision,
    cancel: cancelSegmentationRetry,
    schedule: scheduleSegmentationRetry,
  } = useSemanticSegmentationRetry();
  const enabledRef = useRef(enabled);
  const wasEnabledRef = useRef(false);
  const assistantIdRef = useRef(assistantId);
  const responseGateRef = useRef(new LiveSpeechResponseGate());

  const replaceQueue = useCallback(
    (
      nextAssistantId: string | null,
      displayCursor: number,
      sessionBaselineCursor: number,
      suppressed = false,
    ) => {
      const cursor = reduceLiveSpeechCursors(queueRef.current.cursor, {
        type: 'reset',
        assistantId: nextAssistantId,
        displayCursor,
        sessionBaselineCursor,
      });
      queueRef.current = {
        ...createLiveSpeechQueueState(cursor),
        suppressed,
      };
    },
    [],
  );

  const clearAudioResources = useCallback(
    (suppressCurrent: boolean) => {
      const queue = queueRef.current;
      queue.cursor = reduceLiveSpeechCursors(queue.cursor, {
        type: 'invalidate',
      });
      queue.segmentCursor = nextLiveSpeechSourceCursor(queue.cursor);
      queue.queue = [];
      queue.pumping = false;
      queue.lastWindow = null;
      queue.suppressed = suppressCurrent;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      markerCancelsRef.current.splice(0).forEach((cancel) => cancel());
      finishMarkerCancelRef.current?.();
      finishMarkerCancelRef.current = null;
      cancelSegmentationRetry();
      playerRef.current?.stop();
    },
    [cancelSegmentationRetry],
  );

  const clearAudio = useCallback(
    (suppressCurrent: boolean) => {
      clearAudioResources(suppressCurrent);
      setOutputLevel(0);
    },
    [clearAudioResources],
  );

  const interrupt = useCallback(() => {
    clearAudio(true);
    dispatch({ type: 'interrupt' });
  }, [clearAudio]);

  const prepare = useCallback(() => {
    clearAudioResources(false);
    dispatch({ type: 'finish' });
    setOutputLevel(0);
    playerRef.current ??= new Pcm16Player();
    void playerRef.current.prepare().catch(() => undefined);
  }, [clearAudioResources]);

  const expectNextResponse = useCallback(() => {
    responseGateRef.current.expectNext(assistantIdRef.current);
  }, []);

  const finishWhenPlaybackEnds = useCallback((runId: number) => {
    const queue = queueRef.current;
    if (
      queue.cursor.runId !== runId ||
      queue.pumping ||
      queue.queue.length > 0 ||
      !queue.complete
    ) {
      return;
    }
    finishMarkerCancelRef.current?.();
    const lastWindow = queue.lastWindow;
    if (!lastWindow || !playerRef.current) {
      dispatch({ type: 'finish' });
      setOutputLevel(0);
      return;
    }
    finishMarkerCancelRef.current = playerRef.current.scheduleMarker(
      lastWindow.endAt,
      () => {
        if (queueRef.current.cursor.runId !== runId) return;
        dispatch({ type: 'finish' });
        setOutputLevel(0);
      },
    );
  }, []);

  const pump = useCallback(() => {
    const queue = queueRef.current;
    if (queue.pumping || queue.suppressed || !enabledRef.current) return;
    queue.pumping = true;
    const runId = queue.cursor.runId;
    playerRef.current ??= new Pcm16Player();
    const player = playerRef.current;
    void (async () => {
      try {
        while (
          enabledRef.current &&
          queueRef.current.cursor.runId === runId &&
          queueRef.current.queue.length > 0
        ) {
          const segment = queueRef.current.queue.shift()!;
          const speechText = prepareLiveSpeechText(segment.text);
          if (!speechText) continue;
          finishMarkerCancelRef.current?.();
          finishMarkerCancelRef.current = null;
          dispatch({ type: 'prepare' });
          const controller = new AbortController();
          abortControllerRef.current = controller;
          let heardFirstPcm = false;
          const lastWindow = await streamSpeechIntoPlayer({
            text: speechText,
            signal: controller.signal,
            player,
            cues: createLiveSubtitleCues(speechText),
            onMarker: (at, callback) => {
              markerCancelsRef.current.push(
                player.scheduleMarker(at, callback),
              );
            },
            onLevelMarker: (at, callback) => {
              markerCancelsRef.current.push(
                player.scheduleMarker(at, callback),
              );
            },
            onSubtitle: (text) => {
              if (queueRef.current.cursor.runId === runId) {
                dispatch({ type: 'cue', text });
              }
            },
            onFirstAudio: () => {
              if (heardFirstPcm || queueRef.current.cursor.runId !== runId) {
                return;
              }
              heardFirstPcm = true;
              dispatch({ type: 'start' });
            },
            onAudioLevel: (level) => {
              if (queueRef.current.cursor.runId === runId) {
                setOutputLevel(level);
              }
            },
          });
          if (queueRef.current.cursor.runId !== runId) return;
          if (lastWindow) {
            const segmentAssistantId = queueRef.current.cursor.assistantId;
            queueRef.current.lastWindow = lastWindow;
            if (segmentAssistantId) {
              markerCancelsRef.current.push(
                player.scheduleMarker(lastWindow.endAt, () => {
                  const current = queueRef.current;
                  current.cursor = reduceLiveSpeechCursors(current.cursor, {
                    type: 'played',
                    assistantId: segmentAssistantId,
                    runId,
                    endCursor: segment.endCursor,
                  });
                }),
              );
            }
          }
        }
      } catch (error: unknown) {
        if (queueRef.current.cursor.runId !== runId) return;
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          queueRef.current.suppressed = true;
          dispatch({ type: 'fail' });
        } else {
          dispatch({ type: 'interrupt' });
        }
        setOutputLevel(0);
      } finally {
        if (queueRef.current.cursor.runId !== runId) return;
        abortControllerRef.current = null;
        queueRef.current.pumping = false;
        finishWhenPlaybackEnds(runId);
      }
    })();
  }, [finishWhenPlaybackEnds]);

  useEffect(() => {
    enabledRef.current = enabled;
    assistantIdRef.current = assistantId;
    if (!enabled) {
      wasEnabledRef.current = false;
      responseGateRef.current.reset(assistantId);
      clearAudioResources(false);
      const displayCursor = assistantText?.length ?? 0;
      replaceQueue(assistantId, displayCursor, displayCursor);
      return;
    }
    if (!wasEnabledRef.current) {
      wasEnabledRef.current = true;
      responseGateRef.current.reset(assistantId);
      const displayCursor = assistantText?.length ?? 0;
      replaceQueue(assistantId, displayCursor, displayCursor);
      return;
    }
    if (!assistantId) return;
    if (!responseGateRef.current.accepts(assistantId)) return;
    const text = assistantText ?? '';
    if (queueRef.current.cursor.assistantId !== assistantId) {
      clearAudio(false);
      replaceQueue(assistantId, text.length, 0);
    }
    const queue = queueRef.current;
    if (queue.suppressed) return;
    if (text.length < queue.cursor.displayCursor) {
      clearAudio(true);
      replaceQueue(assistantId, text.length, text.length, true);
      return;
    }
    queue.cursor = reduceLiveSpeechCursors(queue.cursor, {
      type: 'observe',
      assistantId,
      displayCursor: text.length,
    });
    const terminalFailure =
      assistantStatus === 'failed' ||
      assistantStatus === 'cancelled' ||
      assistantStatus === 'interrupted';
    if (terminalFailure) {
      clearAudioResources(true);
      queueMicrotask(() => {
        setOutputLevel(0);
        dispatch({ type: 'interrupt' });
      });
      return;
    }
    queue.complete = assistantStatus === 'completed';
    const nowMs = Date.now();
    if (queue.waitingSinceMs === null && queue.segmentCursor < text.length) {
      queue.waitingSinceMs = nowMs;
    }
    const waitingSinceMs = queue.waitingSinceMs ?? nowMs;
    const previousSegmentCursor = queue.segmentCursor;
    const batch = takeSemanticSpeechSegments({
      text,
      consumedCharacters: queue.segmentCursor,
      segmentCount: queue.segmentCount,
      complete: queue.complete,
      nowMs,
      waitingSinceMs,
    });
    queue.segmentCursor = batch.consumedCharacters;
    queue.segmentCount += batch.segments.length;
    queue.waitingSinceMs =
      queue.segmentCursor >= text.length
        ? null
        : batch.segments.length > 0 ||
            queue.segmentCursor > previousSegmentCursor
          ? nowMs
          : waitingSinceMs;
    const runId = queue.cursor.runId;
    for (const segment of batch.segments) {
      queue.cursor = reduceLiveSpeechCursors(queue.cursor, {
        type: 'commit',
        assistantId,
        runId,
        endCursor: segment.endCursor,
      });
    }
    queue.queue.push(...batch.segments);
    const expectedRunId = queue.cursor.runId;
    const expectedCursor = queue.segmentCursor;
    scheduleSegmentationRetry(batch.retryAfterMs, () => {
      const current = queueRef.current;
      return (
        current.cursor.runId === expectedRunId &&
        current.cursor.assistantId === assistantId &&
        current.segmentCursor === expectedCursor &&
        !current.complete &&
        !current.suppressed
      );
    });
    if (queue.queue.length > 0) pump();
    else finishWhenPlaybackEnds(queue.cursor.runId);
  }, [
    assistantId,
    assistantStatus,
    assistantText,
    clearAudio,
    clearAudioResources,
    enabled,
    finishWhenPlaybackEnds,
    pump,
    replaceQueue,
    scheduleSegmentationRetry,
    segmentationRevision,
  ]);

  useEffect(
    () => () => {
      clearAudioResources(false);
      void playerRef.current?.close();
    },
    [clearAudioResources],
  );

  const visibleState = enabled ? viewState : INITIAL_PLAYBACK_STATE;

  return {
    speaking: visibleState.phase === 'speaking',
    preparing: visibleState.phase === 'preparing',
    subtitle: visibleState.subtitle,
    outputLevel: enabled ? outputLevel : 0,
    playbackFailed: visibleState.playbackFailed,
    prepare,
    expectNextResponse,
    cancelPending: interrupt,
    interrupt,
  };
}
