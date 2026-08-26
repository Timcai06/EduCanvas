'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  AgentAssetPart,
  AgentMessagePart,
  OutputPreference,
} from '@educanvas/agent-core';
import type { InitialChatMessageDTO } from './messages';
import {
  createTeachingTurnState,
  getRetryAssetParts,
  teachingTurnReducer,
} from './turn-state';
import { resolveTurnFailureMessage } from './connection-status';
import type { TeachingTurnEvent } from './turn-events';
import { consumeTeachingTurnResponse } from './turn-stream-consumer';
import type { InFlightTurn } from './turn-send-outcome';
import { useDeepResearchProgress } from './use-deep-research-progress';
import { useActiveTurnRecovery } from './use-active-turn-recovery';
import { useTurnRecoveryRuntime } from './use-turn-recovery';
import { readPublicError } from '@/features/errors/public-error';

const SAFE_INTERRUPTED_ERROR = '回答意外中断了，你可以重新发送这条问题。';
function isBrowserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export interface AgentTurnClientOptions {
  endpoint: string;
  assistantLabel: string;
  cancelEndpoint?: (turnId: string) => string;
  eventsEndpoint?: (turnId: string) => string;
}

export interface AgentTurnClientCallbacks {
  onArtifactProposed?: (
    event: Extract<
      TeachingTurnEvent,
      { type: 'artifact.proposed' | 'artifact.created' }
    >,
  ) => void;
}

export interface AgentTurnSendOptions {
  /** 非可信的呈现偏好；服务端仍独立决定工具授权与输出能力。 */
  outputPreference?: OutputPreference;
  /** 非可信的本轮意图；服务端据此选择既有 Agent Loop 的受限 Profile。 */
  mode?: 'chat' | 'deep_research';
}

const TEACHING_TURN_OPTIONS: AgentTurnClientOptions = {
  endpoint: '/api/v1/learn/turn',
  assistantLabel: 'AI 老师',
  cancelEndpoint: (turnId) =>
    `/api/v1/learn/turn/${encodeURIComponent(turnId)}/cancel`,
};

export function useAgentTurn(
  initialMessages: readonly InitialChatMessageDTO[],
  options: AgentTurnClientOptions,
  callbacks: AgentTurnClientCallbacks = {},
) {
  const safeConnectionError = `${options.assistantLabel}暂时无法连接，请稍后重试。`;
  const cancelEndpoint = options.cancelEndpoint;
  const [state, dispatch] = useReducer(
    teachingTurnReducer,
    initialMessages,
    (messages) =>
      createTeachingTurnState(
        messages,
        options.assistantLabel,
        Boolean(options.eventsEndpoint),
      ),
  );
  const inFlight = useRef<InFlightTurn | null>(null);
  const callbacksRef = useRef(callbacks);
  const mounted = useRef(true);
  const [controlError, setControlError] = useState<string | null>(null);
  const {
    progress: researchProgress,
    begin: beginResearch,
    consume: consumeResearch,
    restore: restoreResearch,
    statusText: researchStatusText,
  } = useDeepResearchProgress();

  const cancelAcceptedTurn = useCallback(
    async (current: InFlightTurn) => {
      if (
        !current.turnId ||
        current.terminalReceived ||
        current.stopConfirmed ||
        !cancelEndpoint
      ) {
        return false;
      }
      try {
        const response = await fetch(cancelEndpoint(current.turnId), {
          method: 'POST',
        });
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
    },
    [cancelEndpoint],
  );

  const { applyTurnEvent, recoverTurn } = useTurnRecoveryRuntime({
    mounted,
    inFlight,
    callbacksRef,
    dispatch,
    setControlError,
    cancelAcceptedTurn,
    consumeResearch,
    restoreResearch,
    eventsEndpoint: options.eventsEndpoint,
  });

  useActiveTurnRecovery({
    active: state.active,
    mounted,
    inFlight,
    dispatch,
    recoverTurn,
  });

  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

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
      sendOptions: AgentTurnSendOptions = {},
    ) => {
      const normalizedText = text.trim();
      if ((!normalizedText && assetParts.length === 0) || inFlight.current)
        return 'rejected' as const;

      const clientMessageId = suppliedId ?? crypto.randomUUID();
      const current: InFlightTurn = {
        clientMessageId,
        controller: new AbortController(),
        turnId: null,
        assistantMessageId: null,
        terminalReceived: false,
        terminalOutcome: null,
        stopConfirmed: false,
        cancelRequested: false,
        recoveryAttempted: false,
        nextSequence: 0,
      };
      inFlight.current = current;
      setControlError(null);
      beginResearch(sendOptions.mode === 'deep_research');
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
        /* 只有 attachment 才在气泡里留痕；笔记本长期来源（context）由 Studio
           统一呈现，否则每条提问都会重复列出全部来源。与 hydrateChatMessages
           的过滤保持一致，避免乐观渲染和刷新后的结果不同。 */
        attachments: assetParts
          .filter((part) => part.usage === 'attachment')
          .map((part) => ({
            id: `${part.reference.assetId}:${part.reference.versionId}`,
            label:
              part.label ??
              (part.reference.kind === 'image' ? '图片附件' : 'PDF资料'),
            kind: part.reference.kind === 'image' ? 'image' : 'document',
          })),
        assistantLabel: options.assistantLabel,
        mode: sendOptions.mode,
      });

      try {
        const response = await fetch(options.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...(assetParts.length > 0
              ? { clientMessageId, parts: requestParts }
              : { clientMessageId, text: normalizedText }),
            ...(sendOptions.outputPreference
              ? { outputPreference: sendOptions.outputPreference }
              : {}),
            ...(sendOptions.mode === 'deep_research'
              ? { mode: sendOptions.mode }
              : {}),
          }),
          signal: current.controller.signal,
        });
        if (!response.ok) {
          const routeError = await readPublicError(
            response,
            safeConnectionError,
          );
          if (mounted.current) {
            dispatch({
              type: 'stream.failed',
              status: 'failed',
              code: routeError.code,
              message: routeError.message,
              retryable: routeError.retryable,
            });
          }
          return 'rejected' as const;
        }

        await consumeTeachingTurnResponse(
          response,
          (event: TeachingTurnEvent) =>
            applyTurnEvent(
              current,
              event,
              sendOptions.mode === 'deep_research',
            ),
        );

        if (
          mounted.current &&
          inFlight.current === current &&
          !current.terminalReceived &&
          !current.stopConfirmed
        ) {
          const recovered = current.turnId
            ? await recoverTurn(current, sendOptions.mode === 'deep_research')
            : false;
          if (recovered || current.terminalReceived) {
            return current.terminalOutcome ?? 'interrupted';
          }
          /* 流未达终态就结束：本机离线时归因给网络，否则按意外中断 */
          const resolved = resolveTurnFailureMessage({
            online: isBrowserOnline(),
            serverMessage: SAFE_INTERRUPTED_ERROR,
            serverRetryable: true,
          });
          dispatch({
            type: 'stream.failed',
            status: 'interrupted',
            code: 'interrupted',
            message: resolved.message,
            retryable: resolved.retryable,
          });
        }
        return current.terminalOutcome ?? 'interrupted';
      } catch (error) {
        const aborted =
          error instanceof DOMException && error.name === 'AbortError';
        if (
          mounted.current &&
          inFlight.current === current &&
          !current.stopConfirmed &&
          current.turnId &&
          !current.terminalReceived
        ) {
          try {
            const recovered = await recoverTurn(
              current,
              sendOptions.mode === 'deep_research',
            );
            if (recovered || current.terminalReceived) {
              return current.terminalOutcome ?? 'interrupted';
            }
          } catch {
            // Fall through to the stable interrupted/connection message.
          }
        }
        if (
          mounted.current &&
          inFlight.current === current &&
          !(aborted && current.stopConfirmed)
        ) {
          /* 用户主动停止的 abort 不算失败；其余按本机在线情况归因 */
          const resolved = resolveTurnFailureMessage({
            online: isBrowserOnline(),
            serverMessage: aborted
              ? SAFE_INTERRUPTED_ERROR
              : safeConnectionError,
            serverRetryable: true,
          });
          dispatch({
            type: 'stream.failed',
            status: aborted ? 'interrupted' : 'failed',
            code: aborted ? 'interrupted' : 'stream_unavailable',
            message: resolved.message,
            retryable: resolved.retryable,
          });
        }
        return current.stopConfirmed ? 'cancelled' : 'interrupted';
      } finally {
        if (inFlight.current === current) inFlight.current = null;
      }
    },
    [
      beginResearch,
      applyTurnEvent,
      recoverTurn,
      options.assistantLabel,
      options.endpoint,
      safeConnectionError,
    ],
  );

  const stop = useCallback(async () => {
    const current = inFlight.current;
    if (!current || current.terminalReceived || !options.cancelEndpoint)
      return false;
    setControlError(null);
    current.cancelRequested = true;
    if (!current.turnId) return true;
    return cancelAcceptedTurn(current);
  }, [cancelAcceptedTurn, options.cancelEndpoint]);

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
      void send(message.retryText ?? '', crypto.randomUUID(), assetParts, {
        mode: message.retryMode,
      });
      return true;
    },
    [send, state.messages],
  );

  const activeStatus = state.active?.status ?? null;
  const statusText = controlError
    ? controlError
    : researchStatusText
      ? researchStatusText
      : state.activeToolLabel
        ? state.activeToolLabel
        : activeStatus === 'streaming'
          ? `${options.assistantLabel}正在回答…`
          : activeStatus === 'pending'
            ? `正在连接${options.assistantLabel}…`
            : null;

  return {
    messages: state.messages,
    announcement: state.announcement,
    activeStatus,
    statusText,
    busy: state.active !== null,
    stopAvailable: Boolean(state.active && options.cancelEndpoint),
    send,
    stop,
    retry,
    researchProgress,
  } as const;
}

export function useTeachingTurn(
  initialMessages: readonly InitialChatMessageDTO[],
) {
  return useAgentTurn(initialMessages, TEACHING_TURN_OPTIONS);
}
