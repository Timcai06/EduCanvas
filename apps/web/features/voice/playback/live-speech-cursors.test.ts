import { describe, expect, it } from 'vitest';
import {
  assertLiveSpeechCursorInvariants,
  INITIAL_LIVE_SPEECH_CURSORS,
  nextLiveSpeechSourceCursor,
  reduceLiveSpeechCursors,
  type LiveSpeechCursorAction,
} from './live-speech-cursors';

function reset(
  displayCursor = 0,
  sessionBaselineCursor = 0,
  assistantId = 'assistant-1',
) {
  return reduceLiveSpeechCursors(INITIAL_LIVE_SPEECH_CURSORS, {
    type: 'reset',
    assistantId,
    displayCursor,
    sessionBaselineCursor,
  });
}

describe('live speech cursor state machine', () => {
  it('入室基线不会冒充已经提交或播放', () => {
    const state = reset(18, 18);
    expect(state).toMatchObject({
      displayCursor: 18,
      speechCommittedCursor: 0,
      audioPlayedCursor: 0,
      sessionBaselineCursor: 18,
      runId: 1,
    });
    expect(nextLiveSpeechSourceCursor(state)).toBe(18);
    expect(assertLiveSpeechCursorInvariants(state)).toBe(true);
  });

  it('重复 observe 不重复推进，增长只移动 displayCursor', () => {
    const initial = reset();
    const first = reduceLiveSpeechCursors(initial, {
      type: 'observe',
      assistantId: 'assistant-1',
      displayCursor: 12,
    });
    const duplicate = reduceLiveSpeechCursors(first, {
      type: 'observe',
      assistantId: 'assistant-1',
      displayCursor: 12,
    });

    expect(duplicate).toBe(first);
    expect(duplicate).toMatchObject({
      displayCursor: 12,
      speechCommittedCursor: 0,
      audioPlayedCursor: 0,
    });
  });

  it('提交和 PCM 完成严格保持三个游标顺序', () => {
    let state = reset();
    state = reduceLiveSpeechCursors(state, {
      type: 'observe',
      assistantId: 'assistant-1',
      displayCursor: 20,
    });
    state = reduceLiveSpeechCursors(state, {
      type: 'commit',
      assistantId: 'assistant-1',
      runId: state.runId,
      endCursor: 12,
    });
    state = reduceLiveSpeechCursors(state, {
      type: 'played',
      assistantId: 'assistant-1',
      runId: state.runId,
      endCursor: 12,
    });

    expect(state).toMatchObject({
      displayCursor: 20,
      speechCommittedCursor: 12,
      audioPlayedCursor: 12,
    });
    expect(assertLiveSpeechCursorInvariants(state)).toBe(true);
  });

  it('空 PCM 或失败路径不发送 played 时不会推进 audioPlayedCursor', () => {
    let state = reset();
    state = reduceLiveSpeechCursors(state, {
      type: 'observe',
      assistantId: 'assistant-1',
      displayCursor: 12,
    });
    state = reduceLiveSpeechCursors(state, {
      type: 'commit',
      assistantId: 'assistant-1',
      runId: state.runId,
      endCursor: 12,
    });

    expect(state.audioPlayedCursor).toBe(0);
  });

  it('取消后旧 run 的 commit 和 played 全部失效', () => {
    let state = reset(20, 0);
    const oldRunId = state.runId;
    state = reduceLiveSpeechCursors(state, { type: 'invalidate' });
    const invalidated = state;
    for (const type of ['commit', 'played'] as const) {
      state = reduceLiveSpeechCursors(state, {
        type,
        assistantId: 'assistant-1',
        runId: oldRunId,
        endCursor: 10,
      });
    }

    expect(state).toEqual(invalidated);
    expect(state.runId).toBe(oldRunId + 1);
  });

  it('Assistant 真正切换和文本回退重置时 runId 单调递增', () => {
    const first = reset(20, 0);
    const switched = reduceLiveSpeechCursors(first, {
      type: 'reset',
      assistantId: 'assistant-2',
      displayCursor: 3,
      sessionBaselineCursor: 0,
    });
    const rollback = reduceLiveSpeechCursors(switched, {
      type: 'reset',
      assistantId: 'assistant-2',
      displayCursor: 1,
      sessionBaselineCursor: 1,
    });

    expect(switched.runId).toBe(first.runId + 1);
    expect(rollback.runId).toBe(switched.runId + 1);
    expect(rollback).toMatchObject({
      displayCursor: 1,
      speechCommittedCursor: 0,
      audioPlayedCursor: 0,
      sessionBaselineCursor: 1,
    });
  });

  it('错误身份、越界和乱序事件 fail closed', () => {
    let state = reset(10, 0);
    const actions: LiveSpeechCursorAction[] = [
      {
        type: 'observe',
        assistantId: 'assistant-other',
        displayCursor: 20,
      },
      {
        type: 'commit',
        assistantId: 'assistant-1',
        runId: state.runId,
        endCursor: 11,
      },
      {
        type: 'played',
        assistantId: 'assistant-1',
        runId: state.runId,
        endCursor: 5,
      },
    ];
    for (const action of actions) {
      state = reduceLiveSpeechCursors(state, action);
      expect(assertLiveSpeechCursorInvariants(state)).toBe(true);
    }
    expect(state).toEqual(reset(10, 0));
  });

  it('任意混合事件后仍保持游标不变量', () => {
    let state = reset();
    const actions: LiveSpeechCursorAction[] = [
      { type: 'observe', assistantId: 'assistant-1', displayCursor: 30 },
      {
        type: 'commit',
        assistantId: 'assistant-1',
        runId: 1,
        endCursor: 10,
      },
      {
        type: 'played',
        assistantId: 'assistant-1',
        runId: 1,
        endCursor: 10,
      },
      { type: 'invalidate' },
      {
        type: 'played',
        assistantId: 'assistant-1',
        runId: 1,
        endCursor: 30,
      },
      {
        type: 'reset',
        assistantId: 'assistant-2',
        displayCursor: 8,
        sessionBaselineCursor: 0,
      },
      {
        type: 'commit',
        assistantId: 'assistant-2',
        runId: 3,
        endCursor: 8,
      },
    ];

    for (const action of actions) {
      state = reduceLiveSpeechCursors(state, action);
      expect(assertLiveSpeechCursorInvariants(state)).toBe(true);
    }
  });
});
