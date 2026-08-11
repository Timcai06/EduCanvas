import type { TurnResult } from '../../shared/turn-result';
import type {
  VoiceAudioInput,
  VoiceSpeechResult,
  VoiceTranscriptionResult,
} from '../../shared/voice-result';
import type { SpeechPlaybackResult } from './speech-player';
import type { VoiceRecordingResult } from './voice-recorder';

export type VoiceSessionPhase =
  | 'starting'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'success'
  | 'error'
  | 'cancelled';

export interface VoiceSessionSnapshot {
  phase: VoiceSessionPhase;
  transcript?: string;
  reply?: string;
  error?: string;
  notice?: string;
  level?: number;
}

export interface VoiceSessionDependencies {
  record(options: {
    signal: AbortSignal;
    onLevel(level: number): void;
  }): Promise<VoiceRecordingResult>;
  transcribe(
    input: VoiceAudioInput,
    requestId: string,
  ): Promise<VoiceTranscriptionResult>;
  turn(text: string, requestId: string): Promise<TurnResult>;
  synthesize(text: string, requestId: string): Promise<VoiceSpeechResult>;
  play(bytes: Uint8Array, signal: AbortSignal): Promise<SpeechPlaybackResult>;
  cancelRemote(requestId: string): void;
  createRequestId(): string;
}

export type VoiceSessionResult =
  | {
      outcome: 'success';
      transcript: string;
      reply: string;
      speechPlayed: boolean;
    }
  | { outcome: 'cancelled' }
  | { outcome: 'error'; code: string; message: string };

const RECORDING_ERRORS: Record<string, string> = {
  permission_denied: '需要麦克风权限才能听你说话',
  no_input: '没有找到可用的麦克风',
  unsupported: '当前设备暂不支持语音录制',
  no_speech: '没有听到声音，请靠近一些再试一次',
  capture_failed: '录音失败，请检查麦克风后重试',
};

function remoteError(code: string): string {
  if (code === 'backend_offline') return '服务暂时未启动，请稍后再试';
  if (code === 'timeout') return '等待超时，请重试';
  return '这次没有处理成功，请重试';
}

/** 执行单轮半双工语音链路；所有中间状态均同步给 UI。 */
export async function runVoiceSession(
  dependencies: VoiceSessionDependencies,
  options: {
    signal: AbortSignal;
    onChange(snapshot: VoiceSessionSnapshot): void;
  },
): Promise<VoiceSessionResult> {
  let activeRequestId: string | null = null;
  let transcript: string | undefined;
  let reply: string | undefined;
  const emit = (snapshot: VoiceSessionSnapshot): void =>
    options.onChange({ ...snapshot, transcript, reply });
  const cancelled = (): VoiceSessionResult => {
    emit({ phase: 'cancelled' });
    return { outcome: 'cancelled' };
  };
  const fail = (code: string, message: string): VoiceSessionResult => {
    emit({ phase: 'error', error: message });
    return { outcome: 'error', code, message };
  };
  const cancelRemote = (): void => {
    if (activeRequestId) dependencies.cancelRemote(activeRequestId);
  };
  options.signal.addEventListener('abort', cancelRemote);

  try {
    if (options.signal.aborted) return cancelled();
    emit({ phase: 'starting' });
    emit({ phase: 'listening', level: 0 });
    const recording = await dependencies.record({
      signal: options.signal,
      onLevel: (level) => emit({ phase: 'listening', level }),
    });
    if (!recording.ok) {
      if (recording.code === 'aborted' || options.signal.aborted)
        return cancelled();
      return fail(
        recording.code,
        RECORDING_ERRORS[recording.code] ?? '录音失败，请重试',
      );
    }
    if (options.signal.aborted) return cancelled();

    emit({ phase: 'transcribing' });
    activeRequestId = dependencies.createRequestId();
    const transcription = await dependencies.transcribe(
      recording.recording,
      activeRequestId,
    );
    activeRequestId = null;
    if (!transcription.ok) {
      if (transcription.code === 'aborted' || options.signal.aborted)
        return cancelled();
      return fail(transcription.code, remoteError(transcription.code));
    }
    if (options.signal.aborted) return cancelled();
    transcript = transcription.text.trim();
    if (!transcript)
      return fail('invalid_response', '没有识别出文字，请再说一次');

    emit({ phase: 'thinking' });
    if (options.signal.aborted) return cancelled();
    activeRequestId = dependencies.createRequestId();
    const turn = await dependencies.turn(transcript, activeRequestId);
    activeRequestId = null;
    if (!turn.ok) {
      if (turn.code === 'aborted' || options.signal.aborted) return cancelled();
      return fail(turn.code, remoteError(turn.code));
    }
    if (options.signal.aborted) return cancelled();
    reply = turn.message.trim() || '已经处理好了';

    emit({ phase: 'speaking' });
    if (options.signal.aborted) return cancelled();
    activeRequestId = dependencies.createRequestId();
    const speech = await dependencies.synthesize(reply, activeRequestId);
    activeRequestId = null;
    if (!speech.ok) {
      if (speech.code === 'aborted' || options.signal.aborted)
        return cancelled();
      emit({
        phase: 'success',
        notice: '语音播报暂不可用，已显示文字回复',
      });
      return { outcome: 'success', transcript, reply, speechPlayed: false };
    }
    const playback = await dependencies.play(speech.bytes, options.signal);
    if (playback === 'aborted' || options.signal.aborted) return cancelled();
    const speechPlayed = playback === 'finished';
    emit({
      phase: 'success',
      ...(speechPlayed ? {} : { notice: '语音播报暂不可用，已显示文字回复' }),
    });
    return { outcome: 'success', transcript, reply, speechPlayed };
  } catch {
    if (options.signal.aborted) return cancelled();
    return fail('unexpected', '发生了意外错误，请重试');
  } finally {
    options.signal.removeEventListener('abort', cancelRemote);
  }
}
