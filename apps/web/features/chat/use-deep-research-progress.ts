'use client';

import { useCallback, useState } from 'react';
import {
  createDeepResearchProgress,
  deepResearchProgressLabel,
  mergeDeepResearchSnapshot,
  reduceDeepResearchTurnEvent,
  type DeepResearchProgress,
} from './deep-research-progress';
import type { TeachingTurnEvent } from './turn-events';
import type { TurnResearchSnapshot } from './turn-recovery';

export function useDeepResearchProgress() {
  const [progress, setProgress] = useState<DeepResearchProgress | null>(null);
  const begin = useCallback((enabled: boolean) => {
    setProgress(enabled ? createDeepResearchProgress() : null);
  }, []);
  const consume = useCallback((enabled: boolean, event: TeachingTurnEvent) => {
    const replayLooksLikeResearch =
      event.type === 'tool.started' &&
      (event.activity === 'web_search' || event.activity === 'web_fetch');
    if (!enabled && !replayLooksLikeResearch) {
      setProgress((current) =>
        current ? reduceDeepResearchTurnEvent(current, event) : current,
      );
      return;
    }
    setProgress((current) =>
      reduceDeepResearchTurnEvent(
        current ?? createDeepResearchProgress(),
        event,
      ),
    );
  }, []);
  const restore = useCallback((snapshot: TurnResearchSnapshot) => {
    setProgress((current) =>
      mergeDeepResearchSnapshot(
        current ?? createDeepResearchProgress(),
        snapshot,
      ),
    );
  }, []);
  return {
    progress,
    begin,
    consume,
    restore,
    statusText:
      progress && progress.phase !== 'completed'
        ? deepResearchProgressLabel(progress)
        : null,
  } as const;
}
