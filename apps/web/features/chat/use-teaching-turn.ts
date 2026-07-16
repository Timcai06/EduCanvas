'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { AgentAssetPart, AgentMessagePart } from '@educanvas/agent-core';
import type { InitialChatMessageDTO } from './messages';
import {
  createTeachingTurnState,
  getRetryAssetParts,
  teachingTurnReducer,
} from './turn-state';
import {
  consumeTeachingTurnResponse,
  type TeachingTurnEvent,
  TurnStreamProtocolError,
} from './turn-events';

const SAFE_CONNECTION_ERROR = 'AI 老师暂时无法连接，请稍后重试。';
const SAFE_INTERRUPTED_ERROR = '回答意外中断了，你可以重新发送这条问题。';

interface InFlightTurn {
  clientMessageId: string;
  controller: AbortController;
  turnId: string | null;
  assistantMessageId: string | null;
  terminalReceived: boolean;
  stopConfirmed: boolean;
}

interface PublicRouteError {
  error?: { code?: unknown; message?: unknown };
}

async function readPublicRouteError(
  response: Response,
): Promise<{ code: string; message: string }> {
  try {
    const body = (await response.json()) as PublicRouteError;
    if (
      typeof body.error?.code === 'string' &&
      typeof body.error.message === 'string'
    ) {
      return { code: body.error.code, message: body.error.message };
    }
  } catch {
    // The browser never exposes raw upstream errors; use the stable fallback.
  }
  return { code: 'turn_unavailable', message: SAFE_CONNECTION_ERROR };
}

export function useTeachingTurn(
  initialMessages: readonly InitialChatMessageDTO[],
) {
  const [state, dispatch] = useReducer(
    teachingTurnReducer,
    initialMessages,
    createTeachingTurnState,
  );
  const inFlight = useRef<InFlightTurn | null>(null);
  const mounted = useRef(true);
  const [controlError, setControlError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inFlight.current?.controller.abort();
      inFlight.current = null;
    };
  }, []);

  const send = useCallback(
    async (
      text: string,
      suppliedId?: string,
      assetParts: readonly (AgentAssetPart & { label?: string })[] = [],
    ) => {
      const normalizedText = text.trim();
      if ((!normalizedText && assetParts.length === 0) || inFlight.current)
        return false;

      const clientMessageId = suppliedId ?? crypto.randomUUID();
      const current: InFlightTurn = {
        clientMessageId,
        controller: new AbortController(),
        turnId: null,
        assistantMessageId: null,
        terminalReceived: false,
        stopConfirmed: false,
      };
      inFlight.current = current;
      setControlError(null);
      const requestParts: readonly AgentMessagePart[] = [
        ...(normalizedText
          ? [{ type: 'text' as const, text: normalizedText }]
          : []),
        ...assetParts.map((part) => ({
          type: part.type,
          reference: part.reference,
          usage: part.usage,
        })),
      ];
      dispatch({
        type: 'send.started',
        clientMessageId,
        text: normalizedText,
        parts: requestParts,
        attachments: assetParts.map((part) => ({
          id: `${part.reference.assetId}:${part.reference.versionId}`,
          label:
            part.label ??
            (part.reference.kind === 'image' ? '图片附件' : 'PDF资料'),
          kind: part.reference.kind === 'image' ? 'image' : 'document',
        })),
      });

      try {
        const response = await fetch('/api/v1/learn/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            assetParts.length > 0
              ? {
                  clientMessageId,
                  parts: requestParts,
                }
              : { clientMessageId, text: normalizedText },
          ),
          signal: current.controller.signal,
        });
        if (!response.ok) {
          const routeError = await readPublicRouteError(response);
          if (mounted.current) {
            dispatch({
              type: 'stream.failed',
              status: 'failed',
              code: routeError.code,
              message: routeError.message,
              retryable: response.status >= 500 || response.status === 429,
            });
          }
          return false;
        }

        await consumeTeachingTurnResponse(
          response,
          (event: TeachingTurnEvent) => {
            if (!mounted.current || inFlight.current !== current) return;
            if (current.terminalReceived) {
              throw new TurnStreamProtocolError(
                'turn stream emitted an event after its terminal event',
              );
            }
            if (event.type === 'turn.accepted') {
              if (current.turnId !== null) {
                throw new TurnStreamProtocolError(
                  'turn stream emitted duplicate acceptance',
                );
              }
              current.turnId = event.turnId;
              current.assistantMessageId = event.assistantMessageId;
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
            if (
              event.type === 'turn.completed' ||
              event.type === 'turn.failed' ||
              event.type === 'turn.cancelled'
            ) {
              current.terminalReceived = true;
              setControlError(null);
            }
            dispatch({ type: 'stream.event', event });
          },
        );

        if (
          mounted.current &&
          inFlight.current === current &&
          !current.terminalReceived &&
          !current.stopConfirmed
        ) {
          dispatch({
            type: 'stream.failed',
            status: 'interrupted',
            code: 'interrupted',
            message: SAFE_INTERRUPTED_ERROR,
            retryable: true,
          });
        }
        return current.terminalReceived;
      } catch (error) {
        const aborted =
          error instanceof DOMException && error.name === 'AbortError';
        if (
          mounted.current &&
          inFlight.current === current &&
          !(aborted && current.stopConfirmed)
        ) {
          dispatch({
            type: 'stream.failed',
            status: aborted ? 'interrupted' : 'failed',
            code: aborted ? 'interrupted' : 'stream_unavailable',
            message: aborted ? SAFE_INTERRUPTED_ERROR : SAFE_CONNECTION_ERROR,
            retryable: true,
          });
        }
        return false;
      } finally {
        if (inFlight.current === current) inFlight.current = null;
      }
    },
    [],
  );

  const stop = useCallback(async () => {
    const current = inFlight.current;
    if (!current?.turnId || current.terminalReceived) return false;
    setControlError(null);
    try {
      const response = await fetch(
        `/api/v1/learn/turn/${encodeURIComponent(current.turnId)}/cancel`,
        { method: 'POST' },
      );
      if (!response.ok) {
        setControlError('暂时无法停止回答，请稍后重试。');
        return false;
      }
      const body = (await response.json()) as {
        accepted?: unknown;
        status?: unknown;
      };
      if (body.accepted !== true && body.status !== 'cancelled') {
        setControlError('回答已经结束，无需再次停止。');
        return false;
      }

      current.stopConfirmed = true;
      current.controller.abort();
      if (mounted.current && inFlight.current === current) {
        dispatch({ type: 'stop.confirmed' });
      }
      return true;
    } catch {
      setControlError('暂时无法停止回答，请稍后重试。');
      return false;
    }
  }, []);

  const retry = useCallback(
    (assistantMessageId: string) => {
      const message = state.messages.find(
        (candidate) =>
          candidate.role === 'assistant' && candidate.id === assistantMessageId,
      );
      if (
        !message ||
        message.role !== 'assistant' ||
        (!message.retryText &&
          !message.retryParts?.some((part) => part.type === 'asset_ref')) ||
        inFlight.current
      ) {
        return false;
      }
      const assetParts = getRetryAssetParts(message);
      void send(message.retryText ?? '', crypto.randomUUID(), assetParts);
      return true;
    },
    [send, state.messages],
  );

  const activeStatus = state.active?.status ?? null;
  const statusText = controlError
    ? controlError
    : state.activeToolLabel
      ? state.activeToolLabel
      : activeStatus === 'streaming'
        ? 'AI 老师正在回答…'
        : activeStatus === 'pending'
          ? '正在连接 AI 老师…'
          : null;

  return {
    messages: state.messages,
    announcement: state.announcement,
    activeStatus,
    statusText,
    busy: state.active !== null,
    stopAvailable: Boolean(state.active?.turnId),
    send,
    stop,
    retry,
  } as const;
}
