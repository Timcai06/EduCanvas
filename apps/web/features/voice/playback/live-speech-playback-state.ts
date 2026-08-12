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

export const INITIAL_PLAYBACK_STATE: LiveSpeechPlaybackViewState = {
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
