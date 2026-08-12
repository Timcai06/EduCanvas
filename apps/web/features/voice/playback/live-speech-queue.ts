import type { PcmPlaybackWindow } from './pcm-player';
import type { SemanticSegment } from './semantic-segmentation';
import {
  INITIAL_LIVE_SPEECH_CURSORS,
  nextLiveSpeechSourceCursor,
  type LiveSpeechCursorState,
} from './live-speech-cursors';

export interface LiveSpeechQueueState {
  cursor: LiveSpeechCursorState;
  segmentCursor: number;
  segmentCount: number;
  queue: SemanticSegment[];
  pumping: boolean;
  complete: boolean;
  suppressed: boolean;
  lastWindow: PcmPlaybackWindow | null;
  waitingSinceMs: number | null;
}

export function createLiveSpeechQueueState(
  cursor: LiveSpeechCursorState = INITIAL_LIVE_SPEECH_CURSORS,
): LiveSpeechQueueState {
  return {
    cursor,
    segmentCursor: nextLiveSpeechSourceCursor(cursor),
    segmentCount: 0,
    queue: [],
    pumping: false,
    complete: false,
    suppressed: false,
    lastWindow: null,
    waitingSinceMs: null,
  };
}
