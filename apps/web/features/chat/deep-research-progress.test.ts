import { describe, expect, it } from 'vitest';
import {
  createDeepResearchProgress,
  mergeDeepResearchSnapshot,
  reduceDeepResearchProgress,
  reduceDeepResearchTurnEvent,
} from './deep-research-progress';

describe('Deep Research progress', () => {
  it('按安全活动统计搜索轮次与成功来源并保持 toolCall 幂等', () => {
    let state = createDeepResearchProgress();
    state = reduceDeepResearchProgress(state, {
      type: 'tool.started',
      toolCallId: 'search-1',
      activity: 'web_search',
    });
    state = reduceDeepResearchProgress(state, {
      type: 'tool.started',
      toolCallId: 'search-1',
      activity: 'web_search',
    });
    state = reduceDeepResearchProgress(state, {
      type: 'tool.started',
      toolCallId: 'fetch-1',
      activity: 'web_fetch',
    });
    state = reduceDeepResearchProgress(state, {
      type: 'tool.completed',
      toolCallId: 'search-1',
    });
    state = reduceDeepResearchProgress(state, {
      type: 'tool.completed',
      toolCallId: 'fetch-1',
    });

    expect(state.searchRounds).toBe(1);
    expect(state.sourceCount).toBe(1);
    expect(state.phase).toBe('reading');
  });

  it('失败的网页读取不计入来源', () => {
    let state = createDeepResearchProgress();
    state = reduceDeepResearchProgress(state, {
      type: 'tool.started',
      toolCallId: 'fetch-1',
      activity: 'web_fetch',
    });
    state = reduceDeepResearchProgress(state, {
      type: 'tool.failed',
      toolCallId: 'fetch-1',
    });
    expect(state.sourceCount).toBe(0);
  });

  it('模型开始输出报告时进入综合阶段', () => {
    const state = reduceDeepResearchTurnEvent(createDeepResearchProgress(), {
      type: 'message.delta',
    });
    expect(state.phase).toBe('synthesizing');
  });

  it('阶段只前进、搜索轮次最多五次，重放不重复计数', () => {
    let state = createDeepResearchProgress();
    for (let index = 0; index < 6; index += 1) {
      const toolCallId = `search-${index}`;
      state = reduceDeepResearchProgress(state, {
        type: 'tool.started',
        toolCallId,
        activity: 'web_search',
      });
      state = reduceDeepResearchProgress(state, {
        type: 'tool.completed',
        toolCallId,
      });
    }
    expect(state.searchRounds).toBe(5);

    state = reduceDeepResearchProgress(state, {
      type: 'tool.started',
      toolCallId: 'fetch-1',
      activity: 'web_fetch',
    });
    state = reduceDeepResearchProgress(state, {
      type: 'tool.completed',
      toolCallId: 'fetch-1',
    });
    state = reduceDeepResearchProgress(state, {
      type: 'research.synthesizing',
    });
    state = reduceDeepResearchProgress(state, {
      type: 'tool.started',
      toolCallId: 'late-search',
      activity: 'web_search',
    });
    state = reduceDeepResearchProgress(state, { type: 'research.completed' });
    state = reduceDeepResearchProgress(state, {
      type: 'tool.completed',
      toolCallId: 'late-search',
    });

    expect(state.phase).toBe('completed');
    expect(state.searchRounds).toBe(5);
    expect(state.sourceCount).toBe(1);
  });

  it('从安全研究快照恢复阶段与终态且不倒退', () => {
    let state = mergeDeepResearchSnapshot(createDeepResearchProgress(), {
      phase: 'planning',
      completedQueryCount: 2,
      candidateCount: 5,
      sourceCount: 0,
      citationOrdinals: [],
      operationStatus: 'running',
      terminal: false,
    });
    state = mergeDeepResearchSnapshot(state, {
      phase: 'reading',
      completedQueryCount: 3,
      candidateCount: 8,
      sourceCount: 4,
      citationOrdinals: [1, 2],
      operationStatus: 'running',
      terminal: false,
    });
    state = mergeDeepResearchSnapshot(state, {
      phase: 'searching',
      completedQueryCount: 1,
      candidateCount: 2,
      sourceCount: 1,
      citationOrdinals: [2, 3],
      operationStatus: 'cancelled',
      terminal: true,
    });

    expect(state).toMatchObject({
      phase: 'cancelled',
      searchRounds: 3,
      candidateCount: 8,
      sourceCount: 4,
      citationOrdinals: [1, 2, 3],
      terminalStatus: 'cancelled',
    });
  });
});
