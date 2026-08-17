'use client';

import { useCallback, useState } from 'react';
import {
  createDeepResearchProgress,
  deepResearchProgressLabel,
  reduceDeepResearchTurnEvent,
  type DeepResearchProgress,
} from './deep-research-progress';
import type { TeachingTurnEvent } from './turn-events';

export function useDeepResearchProgress() {
  const [progress, setProgress] = useState<DeepResearchProgress | null>(null);
  const begin = useCallback((enabled: boolean) => {
    setProgress(enabled ? createDeepResearchProgress() : null);
  }, []);
  const consume = useCallback((enabled: boolean, event: TeachingTurnEvent) => {
    if (!enabled) return;
    setProgress((current) =>
      current ? reduceDeepResearchTurnEvent(current, event) : current,
    );
  }, []);
  return {
    progress,
    begin,
    consume,
    statusText:
      progress && progress.phase !== 'completed'
        ? deepResearchProgressLabel(progress)
        : null,
  } as const;
}
