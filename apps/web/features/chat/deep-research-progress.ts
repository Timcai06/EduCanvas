export type DeepResearchPhase =
  | 'planning'
  | 'searching'
  | 'reading'
  | 'synthesizing'
  | 'completed'
  | 'failed';

type ResearchActivity = 'web_search' | 'web_fetch' | 'other';

export interface DeepResearchProgress {
  readonly phase: DeepResearchPhase;
  readonly searchRounds: number;
  readonly sourceCount: number;
  readonly activities: Readonly<Record<string, ResearchActivity>>;
  readonly settledToolCalls: Readonly<Record<string, true>>;
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
  | { readonly type: 'research.completed' | 'research.failed' };

export function createDeepResearchProgress(): DeepResearchProgress {
  return {
    phase: 'planning',
    searchRounds: 0,
    sourceCount: 0,
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
    return { ...state, phase: 'synthesizing' };
  }
  if (event.type === 'research.completed') {
    return { ...state, phase: 'completed' };
  }
  if (event.type === 'research.failed') {
    return { ...state, phase: 'failed' };
  }
  if (event.type === 'tool.started') {
    if (!event.activity || state.activities[event.toolCallId]) return state;
    return {
      ...state,
      phase:
        event.activity === 'web_search'
          ? 'searching'
          : event.activity === 'web_fetch'
            ? 'reading'
            : state.phase,
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
    phase:
      event.type === 'tool.completed' && activity === 'web_fetch'
        ? 'reading'
        : state.phase,
    sourceCount:
      event.type === 'tool.completed' && activity === 'web_fetch'
        ? Math.min(8, state.sourceCount + 1)
        : state.sourceCount,
    searchRounds:
      event.type === 'tool.completed' && activity === 'web_search'
        ? Math.min(3, state.searchRounds + 1)
        : state.searchRounds,
    settledToolCalls: {
      ...state.settledToolCalls,
      [event.toolCallId]: true,
    },
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
    return reduceDeepResearchProgress(state, { type: 'research.failed' });
  }
  return state;
}

export function deepResearchProgressLabel(
  progress: DeepResearchProgress,
): string {
  if (progress.phase === 'completed') return '深度研究完成';
  if (progress.phase === 'failed') return '深度研究失败，可重试';
  if (progress.phase === 'synthesizing') {
    return `正在综合报告 · ${progress.sourceCount} 个来源`;
  }
  if (progress.phase === 'reading') {
    return `正在读取网页 · ${progress.sourceCount}/5–8 个来源`;
  }
  if (progress.phase === 'searching') {
    return `正在进行第 ${progress.searchRounds}/3 轮搜索 · ${progress.sourceCount} 个来源`;
  }
  return '正在规划研究关键词';
}
