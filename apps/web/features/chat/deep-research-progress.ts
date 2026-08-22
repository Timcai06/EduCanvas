import type { TurnResearchSnapshot } from './turn-recovery';

export type DeepResearchPhase =
  | 'planning'
  | 'searching'
  | 'reading'
  | 'synthesizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

type ResearchActivity = 'web_search' | 'web_fetch' | 'other';

export interface DeepResearchProgress {
  readonly phase: DeepResearchPhase;
  readonly searchRounds: number;
  readonly sourceCount: number;
  readonly candidateCount: number;
  readonly citationOrdinals: readonly number[];
  readonly terminalStatus: 'completed' | 'failed' | 'cancelled' | null;
  readonly activities: Readonly<Record<string, ResearchActivity>>;
  readonly settledToolCalls: Readonly<Record<string, true>>;
}

const PHASE_ORDER: Record<DeepResearchPhase, number> = {
  planning: 0,
  searching: 1,
  reading: 2,
  synthesizing: 3,
  completed: 4,
  failed: 4,
  cancelled: 4,
};

function advancePhase(
  state: DeepResearchProgress,
  phase: DeepResearchPhase,
): DeepResearchPhase {
  if (
    state.phase === 'completed' ||
    state.phase === 'failed' ||
    state.phase === 'cancelled'
  ) {
    return state.phase;
  }
  return PHASE_ORDER[phase] > PHASE_ORDER[state.phase] ? phase : state.phase;
}

export type DeepResearchProgressEvent =
  | {
      readonly type: 'tool.started';
      readonly toolCallId: string;
      readonly activity?: ResearchActivity;
    }
  | {
      readonly type: 'tool.completed' | 'tool.failed';
      readonly toolCallId: string;
    }
  | { readonly type: 'research.synthesizing' }
  | {
      readonly type:
        'research.completed' | 'research.failed' | 'research.cancelled';
    };

export function createDeepResearchProgress(): DeepResearchProgress {
  return {
    phase: 'planning',
    searchRounds: 0,
    sourceCount: 0,
    candidateCount: 0,
    citationOrdinals: [],
    terminalStatus: null,
    activities: {},
    settledToolCalls: {},
  };
}

/** 只消费浏览器安全的活动分类；查询、结果和 Provider 数据不进入 UI 状态。 */
export function reduceDeepResearchProgress(
  state: DeepResearchProgress,
  event: DeepResearchProgressEvent,
): DeepResearchProgress {
  if (event.type === 'research.synthesizing') {
    return { ...state, phase: advancePhase(state, 'synthesizing') };
  }
  if (event.type === 'research.completed') {
    return {
      ...state,
      phase: advancePhase(state, 'completed'),
      terminalStatus: state.terminalStatus ?? 'completed',
    };
  }
  if (event.type === 'research.failed') {
    return {
      ...state,
      phase: advancePhase(state, 'failed'),
      terminalStatus: state.terminalStatus ?? 'failed',
    };
  }
  if (event.type === 'research.cancelled') {
    return {
      ...state,
      phase: advancePhase(state, 'cancelled'),
      terminalStatus: state.terminalStatus ?? 'cancelled',
    };
  }
  if (event.type === 'tool.started') {
    if (!event.activity || state.activities[event.toolCallId]) return state;
    return {
      ...state,
      phase: advancePhase(
        state,
        event.activity === 'web_search'
          ? 'searching'
          : event.activity === 'web_fetch'
            ? 'reading'
            : state.phase,
      ),
      activities: {
        ...state.activities,
        [event.toolCallId]: event.activity,
      },
    };
  }
  if (event.type !== 'tool.completed' && event.type !== 'tool.failed') {
    return state;
  }
  if (state.settledToolCalls[event.toolCallId]) return state;
  const activity = state.activities[event.toolCallId];
  return {
    ...state,
    phase: advancePhase(
      state,
      event.type === 'tool.completed' && activity === 'web_fetch'
        ? 'reading'
        : state.phase,
    ),
    sourceCount:
      event.type === 'tool.completed' && activity === 'web_fetch'
        ? Math.min(8, state.sourceCount + 1)
        : state.sourceCount,
    searchRounds:
      event.type === 'tool.completed' && activity === 'web_search'
        ? Math.min(5, state.searchRounds + 1)
        : state.searchRounds,
    settledToolCalls: {
      ...state.settledToolCalls,
      [event.toolCallId]: true,
    },
  };
}

export function mergeDeepResearchSnapshot(
  state: DeepResearchProgress,
  snapshot: TurnResearchSnapshot,
): DeepResearchProgress {
  const terminalStatus =
    snapshot.terminal ||
    (snapshot.operationStatus !== 'running' &&
      snapshot.operationStatus !== 'pending')
      ? snapshot.operationStatus === 'completed'
        ? 'completed'
        : snapshot.operationStatus === 'cancelled'
          ? 'cancelled'
          : 'failed'
      : null;
  const snapshotPhase = advancePhase(state, snapshot.phase);
  const terminalPhase = terminalStatus
    ? advancePhase(
        { ...state, phase: snapshotPhase },
        terminalStatus === 'completed' ? 'completed' : terminalStatus,
      )
    : snapshotPhase;
  return {
    ...state,
    phase: terminalPhase,
    searchRounds: Math.max(state.searchRounds, snapshot.completedQueryCount),
    candidateCount: Math.max(state.candidateCount, snapshot.candidateCount),
    sourceCount: Math.max(state.sourceCount, snapshot.sourceCount),
    citationOrdinals: [
      ...new Set([...state.citationOrdinals, ...snapshot.citationOrdinals]),
    ].sort((left, right) => left - right),
    terminalStatus: terminalStatus ?? state.terminalStatus,
  };
}

export function reduceDeepResearchTurnEvent(
  state: DeepResearchProgress,
  event: {
    readonly type: string;
    readonly toolCallId?: string;
    readonly activity?: ResearchActivity;
  },
): DeepResearchProgress {
  if (
    event.type === 'tool.started' ||
    event.type === 'tool.completed' ||
    event.type === 'tool.failed'
  ) {
    if (!event.toolCallId) return state;
    return reduceDeepResearchProgress(state, {
      type: event.type,
      toolCallId: event.toolCallId,
      ...(event.type === 'tool.started' && event.activity
        ? { activity: event.activity }
        : {}),
    });
  }
  if (event.type === 'message.delta') {
    return reduceDeepResearchProgress(state, { type: 'research.synthesizing' });
  }
  if (event.type === 'turn.completed') {
    return reduceDeepResearchProgress(state, { type: 'research.completed' });
  }
  if (event.type === 'turn.failed' || event.type === 'turn.cancelled') {
    return reduceDeepResearchProgress(state, {
      type:
        event.type === 'turn.cancelled'
          ? 'research.cancelled'
          : 'research.failed',
    });
  }
  return state;
}

export function deepResearchProgressLabel(
  progress: DeepResearchProgress,
): string {
  if (progress.phase === 'completed') return '深度研究完成';
  if (progress.phase === 'failed') return '深度研究失败，可重试';
  if (progress.phase === 'cancelled') return '深度研究已停止';
  if (progress.phase === 'synthesizing') {
    return `正在综合报告 · ${progress.sourceCount} 个来源`;
  }
  if (progress.phase === 'reading') {
    return `正在读取网页 · ${progress.sourceCount}/5–8 个来源`;
  }
  if (progress.phase === 'searching') {
    return `正在进行第 ${Math.min(5, progress.searchRounds + 1)}/5 轮搜索 · ${progress.sourceCount} 个来源`;
  }
  return '正在规划研究关键词';
}
