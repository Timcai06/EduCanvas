'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Own the one-shot clock that rechecks a stalled streamed speech suffix. */
export function useSemanticSegmentationRetry(): {
  readonly revision: number;
  readonly cancel: () => void;
  readonly schedule: (
    delayMs: number | null,
    shouldRetry: () => boolean,
  ) => void;
} {
  const timerRef = useRef<number | null>(null);
  const [revision, setRevision] = useState(0);

  const cancel = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const schedule = useCallback(
    (delayMs: number | null, shouldRetry: () => boolean) => {
      cancel();
      if (delayMs === null) return;
      timerRef.current = window.setTimeout(
        () => {
          timerRef.current = null;
          if (shouldRetry()) setRevision((current) => current + 1);
        },
        Math.max(1, delayMs),
      );
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]);
  return { revision, cancel, schedule };
}
