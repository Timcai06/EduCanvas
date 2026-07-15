import { describe, expect, it } from 'vitest';
import {
  buildLearningSessionRailRows,
  getLearningRailCapabilities,
} from './learning-rail-model';

const sessions = [
  {
    id: 'session-current',
    title: '图像分类初探',
    courseTitle: '人工智能通识',
    status: 'active' as const,
    lastActivityAt: '2026-07-15T08:00:00.000Z',
    hasInterruptedTurn: false,
  },
  {
    id: 'session-old',
    title: '机器如何学习',
    courseTitle: '人工智能通识',
    status: 'archived' as const,
    lastActivityAt: '2026-07-14T08:00:00.000Z',
    hasInterruptedTurn: true,
  },
] as const;

describe('Learning Rail view model', () => {
  it('marks only real non-current sessions as resumable', () => {
    expect(
      buildLearningSessionRailRows(sessions, 'session-current', true).map(
        ({ current, resumable }) => ({ current, resumable }),
      ),
    ).toEqual([
      { current: true, resumable: false },
      { current: false, resumable: true },
    ]);
    expect(
      buildLearningSessionRailRows(sessions, 'session-current', false).every(
        (row) => !row.resumable,
      ),
    ).toBe(true);
  });

  it('hides search and pagination until both data and callbacks are real', () => {
    expect(
      getLearningRailCapabilities({
        searchEnabled: true,
        hasSearchCallback: false,
        hasMore: true,
        hasLoadMoreCallback: false,
      }),
    ).toEqual({ showSearch: false, showLoadMore: false });
    expect(
      getLearningRailCapabilities({
        searchEnabled: true,
        hasSearchCallback: true,
        hasMore: true,
        hasLoadMoreCallback: true,
      }),
    ).toEqual({ showSearch: true, showLoadMore: true });
  });
});
