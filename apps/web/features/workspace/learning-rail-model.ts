import type { LearningSessionSummaryDTO } from '@/features/learning/learning-contracts';

export interface LearningSessionRailRow {
  session: LearningSessionSummaryDTO;
  current: boolean;
  resumable: boolean;
}

/** Pure view model keeps current/resume semantics testable without a DOM. */
export function buildLearningSessionRailRows(
  sessions: readonly LearningSessionSummaryDTO[],
  currentSessionId: string | null,
  resumeCapabilityAvailable: boolean,
): readonly LearningSessionRailRow[] {
  return sessions.map((session) => {
    const current = session.id === currentSessionId;
    return {
      session,
      current,
      resumable: resumeCapabilityAvailable && !current,
    };
  });
}

export function getLearningRailCapabilities(input: {
  searchEnabled: boolean;
  hasSearchCallback: boolean;
  hasMore: boolean;
  hasLoadMoreCallback: boolean;
}) {
  return {
    showSearch: input.searchEnabled && input.hasSearchCallback,
    showLoadMore: input.hasMore && input.hasLoadMoreCallback,
  } as const;
}
