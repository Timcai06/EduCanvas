'use client';

import { useEffect, type Dispatch, type RefObject } from 'react';
import type { ActiveTeachingTurn, TeachingTurnAction } from './turn-state';
import type { InFlightTurn } from './turn-send-outcome';

const SAFE_INTERRUPTED_ERROR = '回答意外中断了，你可以重新发送这条问题。';

/** Refresh recovery starts from sequence zero because streaming message text is not a cursor. */
export function useActiveTurnRecovery(input: {
  active: ActiveTeachingTurn | null;
  mounted: RefObject<boolean>;
  inFlight: RefObject<InFlightTurn | null>;
  dispatch: Dispatch<TeachingTurnAction>;
  recoverTurn: (
    current: InFlightTurn,
    researchEnabled: boolean,
  ) => Promise<boolean>;
}) {
  const {
    active,
    mounted: mountedRef,
    inFlight: inFlightRef,
    dispatch,
    recoverTurn,
  } = input;
  useEffect(() => {
    if (!active?.turnId || inFlightRef.current) return;
    const current: InFlightTurn = {
      clientMessageId: active.clientMessageId,
      controller: new AbortController(),
      turnId: active.turnId,
      assistantMessageId: active.assistantMessageId,
      terminalReceived: false,
      terminalOutcome: null,
      stopConfirmed: false,
      cancelRequested: false,
      recoveryAttempted: false,
      nextSequence: 0,
    };
    inFlightRef.current = current;
    void (async () => {
      try {
        const recovered = await recoverTurn(current, false);
        if (
          mountedRef.current &&
          inFlightRef.current === current &&
          !recovered &&
          !current.terminalReceived
        ) {
          dispatch({
            type: 'stream.failed',
            status: 'interrupted',
            code: 'interrupted',
            message: SAFE_INTERRUPTED_ERROR,
            retryable: true,
          });
        }
      } catch {
        if (mountedRef.current && inFlightRef.current === current) {
          dispatch({
            type: 'stream.failed',
            status: 'interrupted',
            code: 'interrupted',
            message: SAFE_INTERRUPTED_ERROR,
            retryable: true,
          });
        }
      } finally {
        if (inFlightRef.current === current) inFlightRef.current = null;
      }
    })();
  }, [active, dispatch, inFlightRef, mountedRef, recoverTurn]);
}
