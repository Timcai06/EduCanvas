import { describe, expect, it } from 'vitest';
import {
  createDeepResearchProgress,
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
});
