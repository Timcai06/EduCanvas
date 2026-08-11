export type VoiceVadDecision =
  'continue' | 'speech-started' | 'complete' | 'no-speech' | 'max-duration';

export interface VoiceVad {
  observe(level: number, nowMs: number): VoiceVadDecision;
}

const SPEECH_THRESHOLD = 0.03;
const SILENCE_THRESHOLD = 0.015;
const MIN_SPEECH_MS = 200;
const END_SILENCE_MS = 900;
const NO_SPEECH_MS = 8_000;
const MAX_DURATION_MS = 30_000;

/** 基于归一化 RMS 与显式时间戳的确定性单轮 VAD。 */
export function createVoiceVad(): VoiceVad {
  let startedAt: number | null = null;
  let lastAt: number | null = null;
  let voicedMs = 0;
  let hasSpeech = false;
  let silenceStartedAt: number | null = null;
  let settled = false;

  return {
    observe(level, nowMs) {
      if (settled) return 'continue';
      startedAt ??= nowMs;
      const elapsed = Math.max(0, nowMs - startedAt);
      if (elapsed >= MAX_DURATION_MS) {
        settled = true;
        return 'max-duration';
      }

      const delta = lastAt === null ? 0 : Math.max(0, nowMs - lastAt);
      lastAt = nowMs;
      let decision: VoiceVadDecision = 'continue';
      if (level >= SPEECH_THRESHOLD) {
        voicedMs += delta;
        silenceStartedAt = null;
        if (!hasSpeech && voicedMs >= MIN_SPEECH_MS) {
          hasSpeech = true;
          decision = 'speech-started';
        }
      } else if (hasSpeech && level <= SILENCE_THRESHOLD) {
        silenceStartedAt ??= nowMs;
        if (nowMs - silenceStartedAt >= END_SILENCE_MS) {
          settled = true;
          return 'complete';
        }
      }

      if (!hasSpeech && elapsed >= NO_SPEECH_MS) {
        settled = true;
        return 'no-speech';
      }
      return decision;
    },
  };
}

export function selectVoiceRecordingMimeType(
  isTypeSupported: (mimeType: string) => boolean,
): 'audio/webm;codecs=opus' | 'audio/webm' | null {
  if (isTypeSupported('audio/webm;codecs=opus'))
    return 'audio/webm;codecs=opus';
  if (isTypeSupported('audio/webm')) return 'audio/webm';
  return null;
}
