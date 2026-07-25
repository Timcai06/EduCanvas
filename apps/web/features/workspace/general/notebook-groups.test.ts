import { describe, expect, it } from 'vitest';
import {
  groupNotebooksByRecency,
  type NotebookListItem,
} from './notebook-groups';

/** 固定参考时刻：2026-07-25 14:30 本地时间，便于按整日差断言桶边界。 */
const NOW = new Date(2026, 6, 25, 14, 30, 0);

function item(id: string, at: Date): NotebookListItem {
  return { id, title: id, lastActivityAt: at.toISOString() };
}

/** 取某个桶内的 id 顺序；桶不存在则视为空，避免严格索引访问的 undefined。 */
function idsOf(
  groups: ReturnType<typeof groupNotebooksByRecency>,
  key: string,
): string[] {
  return (groups.find((group) => group.key === key)?.items ?? []).map(
    (entry) => entry.id,
  );
}

/** 从参考日的本地零点回退 days 天再叠加 hour，稳定落在目标日历日内。 */
function daysAgo(days: number, hour = 9): Date {
  return new Date(2026, 6, 25 - days, hour, 0, 0);
}

describe('groupNotebooksByRecency', () => {
  it('returns no groups for an empty list', () => {
    expect(groupNotebooksByRecency([], NOW)).toEqual([]);
  });

  it('separates today from yesterday by calendar day, not 24h', () => {
    // 今天凌晨 00:10 与昨天深夜 23:50 只差 20 分钟，但应分入不同桶。
    const groups = groupNotebooksByRecency(
      [
        item('early-today', new Date(2026, 6, 25, 0, 10)),
        item('late-yesterday', new Date(2026, 6, 24, 23, 50)),
      ],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(['today', 'yesterday']);
    expect(idsOf(groups, 'today')).toEqual(['early-today']);
    expect(idsOf(groups, 'yesterday')).toEqual(['late-yesterday']);
  });

  it('places days 2..7 in prev7 and day 8 in prev30', () => {
    const groups = groupNotebooksByRecency(
      [item('d7', daysAgo(7)), item('d8', daysAgo(8))],
      NOW,
    );
    expect(idsOf(groups, 'prev7')).toEqual(['d7']);
    expect(idsOf(groups, 'prev30')).toEqual(['d8']);
  });

  it('places day 30 in prev30 and day 31 in older', () => {
    const groups = groupNotebooksByRecency(
      [item('d30', daysAgo(30)), item('d31', daysAgo(31))],
      NOW,
    );
    expect(idsOf(groups, 'prev30')).toEqual(['d30']);
    expect(idsOf(groups, 'older')).toEqual(['d31']);
  });

  it('orders groups today→older and sorts items within a bucket newest-first', () => {
    const groups = groupNotebooksByRecency(
      [
        item('today-morning', new Date(2026, 6, 25, 9, 0)),
        item('older', daysAgo(40)),
        item('today-noon', new Date(2026, 6, 25, 12, 0)),
      ],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(['today', 'older']);
    // 桶内倒序：中午晚于早晨。
    expect(idsOf(groups, 'today')).toEqual(['today-noon', 'today-morning']);
  });

  it('treats a future timestamp (clock skew) as today', () => {
    const groups = groupNotebooksByRecency(
      [item('future', new Date(2026, 6, 26, 8, 0))],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(['today']);
  });
});
