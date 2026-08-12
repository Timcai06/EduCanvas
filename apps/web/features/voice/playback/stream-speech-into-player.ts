import type { PcmPlaybackWindow } from './pcm-player';
import type { LiveSubtitleCue } from './live-speech-text';

export interface LiveSpeechPcmPlayer {
  enqueue(bytes: Uint8Array): Promise<PcmPlaybackWindow | null>;
}

interface StreamSpeechOptions {
  readonly text: string;
  readonly signal: AbortSignal;
  readonly player: LiveSpeechPcmPlayer;
  readonly cues: readonly LiveSubtitleCue[];
  readonly onMarker: (at: number, callback: () => void) => void;
  readonly onLevelMarker?: (at: number, callback: () => void) => void;
  readonly onSubtitle: (text: string) => void;
  readonly onFirstAudio?: (window: PcmPlaybackWindow) => void;
  readonly onAudioLevel?: (level: number) => void;
  readonly fetchImpl?: typeof fetch;
}

export function pcmLevel(bytes: Uint8Array): number {
  if (bytes.byteLength < 2) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  const samples = Math.floor(bytes.byteLength / 2);
  for (let index = 0; index < samples; index += 1) {
    const value = view.getInt16(index * 2, true) / 32_768;
    sum += value * value;
  }
  return Math.min(1, Math.sqrt(sum / samples) * 4.5);
}

/** 逐短语 HTTP 兼容 transport：只负责验证字节并映射到 Web Audio 时间轴。 */
export async function streamSpeechIntoPlayer({
  text,
  signal,
  player,
  cues,
  onMarker,
  onLevelMarker,
  onSubtitle,
  onFirstAudio,
  onAudioLevel,
  fetchImpl = fetch,
}: StreamSpeechOptions): Promise<PcmPlaybackWindow | null> {
  const response = await fetchImpl('/api/v1/voice/live/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error('speech');
  const reader = response.body.getReader();
  let carry: Uint8Array | null = null;
  let queuedContentSeconds = 0;
  let nextCueIndex = 0;
  let lastWindow: PcmPlaybackWindow | null = null;
  let firstAudioDelivered = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    let bytes = value;
    if (carry) {
      const joined = new Uint8Array(carry.byteLength + value.byteLength);
      joined.set(carry);
      joined.set(value, carry.byteLength);
      bytes = joined;
      carry = null;
    }
    if (bytes.byteLength % 2 === 1) {
      carry = bytes.slice(-1);
      bytes = bytes.slice(0, -1);
    }
    const level = pcmLevel(bytes);
    const window = await player.enqueue(bytes);
    if (!window) continue;
    if (onAudioLevel) {
      (onLevelMarker ?? onMarker)(window.startAt, () => onAudioLevel(level));
    }
    if (!firstAudioDelivered) {
      firstAudioDelivered = true;
      onFirstAudio?.(window);
    }
    const contentBeforeWindow = queuedContentSeconds;
    queuedContentSeconds += window.durationSeconds;
    lastWindow = window;
    while (
      nextCueIndex < cues.length &&
      cues[nextCueIndex]!.startOffsetSeconds <= queuedContentSeconds
    ) {
      const cue = cues[nextCueIndex]!;
      const withinWindow = Math.max(
        0,
        cue.startOffsetSeconds - contentBeforeWindow,
      );
      const markerAt =
        window.startAt + Math.min(window.durationSeconds, withinWindow);
      onMarker(markerAt, () => onSubtitle(cue.text));
      nextCueIndex += 1;
    }
  }
  return lastWindow;
}
