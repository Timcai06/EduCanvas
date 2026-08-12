export interface LiveSpeechCursorState {
  /** 稳定的 clientMessageId；服务端 message.id 替换不会改变它。 */
  readonly assistantId: string | null;
  /** 当前 canonical message.text 的 UTF-16 偏移。 */
  readonly displayCursor: number;
  /** 已提交到本地语音队列的最高原文偏移。 */
  readonly speechCommittedCursor: number;
  /** 对应 PCM 完成标记已经触发的最高原文偏移。 */
  readonly audioPlayedCursor: number;
  /** 入室前已有文字的跳过边界；它不冒充已提交或已播放。 */
  readonly sessionBaselineCursor: number;
  /** 每次重置或失效都严格递增，迟到异步事件必须携带原 runId。 */
  readonly runId: number;
}

export type LiveSpeechCursorAction =
  | {
      readonly type: 'reset';
      readonly assistantId: string | null;
      readonly displayCursor: number;
      readonly sessionBaselineCursor: number;
    }
  | {
      readonly type: 'observe';
      readonly assistantId: string;
      readonly displayCursor: number;
    }
  | {
      readonly type: 'commit';
      readonly assistantId: string;
      readonly runId: number;
      readonly endCursor: number;
    }
  | {
      readonly type: 'played';
      readonly assistantId: string;
      readonly runId: number;
      readonly endCursor: number;
    }
  | { readonly type: 'invalidate' };

export const INITIAL_LIVE_SPEECH_CURSORS: LiveSpeechCursorState = {
  assistantId: null,
  displayCursor: 0,
  speechCommittedCursor: 0,
  audioPlayedCursor: 0,
  sessionBaselineCursor: 0,
  runId: 0,
};

function isCursor(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/** 状态机只接受保持边界的事件；异常或迟到事件原样丢弃。 */
export function reduceLiveSpeechCursors(
  state: LiveSpeechCursorState,
  action: LiveSpeechCursorAction,
): LiveSpeechCursorState {
  if (action.type === 'reset') {
    if (
      !isCursor(action.displayCursor) ||
      !isCursor(action.sessionBaselineCursor) ||
      action.sessionBaselineCursor > action.displayCursor
    ) {
      return state;
    }
    return {
      assistantId: action.assistantId,
      displayCursor: action.displayCursor,
      speechCommittedCursor: 0,
      audioPlayedCursor: 0,
      sessionBaselineCursor: action.sessionBaselineCursor,
      runId: state.runId + 1,
    };
  }

  if (action.type === 'invalidate') {
    return {
      ...state,
      speechCommittedCursor: 0,
      audioPlayedCursor: 0,
      sessionBaselineCursor: state.displayCursor,
      runId: state.runId + 1,
    };
  }

  if (action.assistantId !== state.assistantId) return state;

  if (action.type === 'observe') {
    if (
      !isCursor(action.displayCursor) ||
      action.displayCursor < state.displayCursor
    ) {
      return state;
    }
    return action.displayCursor === state.displayCursor
      ? state
      : { ...state, displayCursor: action.displayCursor };
  }

  if (action.runId !== state.runId || !isCursor(action.endCursor)) {
    return state;
  }

  if (action.type === 'commit') {
    const lowerBound = Math.max(
      state.sessionBaselineCursor,
      state.speechCommittedCursor,
    );
    if (
      action.endCursor <= lowerBound ||
      action.endCursor > state.displayCursor
    ) {
      return state;
    }
    return { ...state, speechCommittedCursor: action.endCursor };
  }

  if (
    action.endCursor <= state.audioPlayedCursor ||
    action.endCursor > state.speechCommittedCursor
  ) {
    return state;
  }
  return { ...state, audioPlayedCursor: action.endCursor };
}

export function assertLiveSpeechCursorInvariants(
  state: LiveSpeechCursorState,
): boolean {
  return (
    isCursor(state.displayCursor) &&
    isCursor(state.speechCommittedCursor) &&
    isCursor(state.audioPlayedCursor) &&
    isCursor(state.sessionBaselineCursor) &&
    state.sessionBaselineCursor <= state.displayCursor &&
    state.audioPlayedCursor <= state.speechCommittedCursor &&
    state.speechCommittedCursor <= state.displayCursor
  );
}

/** 下一次分段从入室基线与已提交偏移中较大的位置继续。 */
export function nextLiveSpeechSourceCursor(
  state: LiveSpeechCursorState,
): number {
  return Math.max(state.sessionBaselineCursor, state.speechCommittedCursor);
}
