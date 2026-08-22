'use client';

import { useCallback, type Dispatch, type RefObject } from 'react';
import type { TeachingTurnAction } from './turn-state';
import type { TeachingTurnEvent } from './turn-events';
import { TurnStreamProtocolError } from './turn-events';
import type { InFlightTurn } from './turn-send-outcome';
import { terminalEventTypeToSendOutcome } from './turn-send-outcome';
import { TurnRecoveryController } from './turn-recovery';
import type { TurnResearchSnapshot } from './turn-recovery';

interface RecoveryCallbacks {
  onArtifactProposed?: (
    event: Extract<
      TeachingTurnEvent,
      { type: 'artifact.proposed' | 'artifact.created' }
    >,
  ) => void;
}

export function useTurnRecoveryRuntime(input: {
  mounted: RefObject<boolean>;
  inFlight: RefObject<InFlightTurn | null>;
  callbacksRef: RefObject<RecoveryCallbacks>;
  dispatch: Dispatch<TeachingTurnAction>;
  setControlError: Dispatch<string | null>;
  cancelAcceptedTurn: (current: InFlightTurn) => Promise<boolean>;
  consumeResearch: (enabled: boolean, event: TeachingTurnEvent) => void;
  restoreResearch: (snapshot: TurnResearchSnapshot) => void;
  eventsEndpoint?: (turnId: string) => string;
}) {
  const {
    mounted,
    inFlight,
    callbacksRef,
    dispatch,
    setControlError,
    cancelAcceptedTurn,
    consumeResearch,
    restoreResearch,
    eventsEndpoint,
  } = input;
  const applyTurnEvent = useCallback(
    (
      current: InFlightTurn,
      event: TeachingTurnEvent,
      researchEnabled: boolean,
      allowReplayedAcceptance = false,
    ) => {
      if (!mounted.current || inFlight.current !== current) return;
      if (current.terminalReceived) {
        throw new TurnStreamProtocolError(
          'turn stream emitted an event after its terminal event',
        );
      }
      if (event.type === 'turn.accepted') {
        if (current.turnId !== null) {
          if (
            !allowReplayedAcceptance ||
            current.turnId !== event.turnId ||
            current.assistantMessageId !== event.assistantMessageId
          ) {
            throw new TurnStreamProtocolError(
              'turn stream emitted duplicate acceptance',
            );
          }
        } else {
          current.turnId = event.turnId;
          current.assistantMessageId = event.assistantMessageId;
          if (current.cancelRequested) {
            void cancelAcceptedTurn(current);
          }
        }
      } else if (current.turnId === null) {
        throw new TurnStreamProtocolError(
          'turn stream emitted an event before acceptance',
        );
      } else if (current.turnId !== event.turnId) {
        throw new TurnStreamProtocolError(
          'turn stream changed its turn identity',
        );
      } else if (
        'messageId' in event &&
        current.assistantMessageId !== event.messageId
      ) {
        throw new TurnStreamProtocolError(
          'turn stream changed its message identity',
        );
      }
      if (event.sequence !== undefined) {
        if (event.sequence <= current.nextSequence) {
          throw new TurnStreamProtocolError(
            'turn stream sequence did not advance',
          );
        }
        current.nextSequence = event.sequence;
      } else {
        current.nextSequence += 1;
      }
      if (
        event.type === 'turn.completed' ||
        event.type === 'turn.failed' ||
        event.type === 'turn.cancelled'
      ) {
        current.terminalReceived = true;
        current.terminalOutcome = terminalEventTypeToSendOutcome(event.type);
        setControlError(null);
      }
      if (
        event.type === 'artifact.proposed' ||
        event.type === 'artifact.created'
      ) {
        callbacksRef.current.onArtifactProposed?.(event);
      }
      consumeResearch(researchEnabled, event);
      dispatch({ type: 'stream.event', event });
    },
    [
      callbacksRef,
      cancelAcceptedTurn,
      consumeResearch,
      dispatch,
      inFlight,
      mounted,
      setControlError,
    ],
  );

  const recoverTurn = useCallback(
    async (current: InFlightTurn, researchEnabled: boolean) => {
      if (
        !current.turnId ||
        current.recoveryAttempted ||
        current.stopConfirmed ||
        !eventsEndpoint
      ) {
        return false;
      }
      current.recoveryAttempted = true;
      const controller = new TurnRecoveryController({
        eventsEndpoint,
        onResearchSnapshot: restoreResearch,
      });
      const result = await controller.recover(
        current.turnId,
        current.nextSequence,
        (event) => applyTurnEvent(current, event, researchEnabled, true),
        current.controller.signal,
      );
      current.nextSequence = result.nextSequence;
      return result.terminal;
    },
    [applyTurnEvent, eventsEndpoint, restoreResearch],
  );

  return { applyTurnEvent, recoverTurn } as const;
}
