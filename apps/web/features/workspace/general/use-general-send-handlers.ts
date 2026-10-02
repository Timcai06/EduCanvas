'use client';

import { useCallback, useEffect } from 'react';
import type {
  ArtifactProposalKind,
  OutputPreference,
} from '@educanvas/agent-core';
import type { AgentTurnSendOptions } from '@/features/chat/turn-client-types';
import type { AgentTurnSendOutcome } from '@/features/chat/turn-send-outcome';
import type {
  LiveVoiceContextAsset,
  LiveVoiceContextSnapshot,
} from '@/features/voice/live-voice-context';
import { MIND_MAP_ASK_NODE_EVENT } from '@/features/canvas/mind-map-layout';

export interface ConfirmationAction {
  confirmationId: string;
  kind: ArtifactProposalKind;
  clientMessageId: string;
}

type GeneralTurnSender = (
  text: string,
  frozenAssets?: readonly LiveVoiceContextAsset[],
  preference?: OutputPreference,
  mode?: 'chat' | 'deep_research',
  confirmation?: ConfirmationAction,
  ) => Promise<AgentTurnSendOutcome>;

export function createArtifactConfirmationSendOptions(
  preference: OutputPreference,
  mode: 'chat' | 'deep_research',
  confirmation?: ConfirmationAction,
): AgentTurnSendOptions {
  return {
    outputPreference: preference,
    mode,
    ...(confirmation
      ? { artifactConfirmationId: confirmation.confirmationId }
      : {}),
  };
}

export function useGeneralSendHandlers(send: GeneralTurnSender) {
  const sendLive = useCallback(
    (text: string, context: LiveVoiceContextSnapshot) =>
      send(text, context.assets),
    [send],
  );
  const onArtifactConfirmation = useCallback(
    (confirmation: ConfirmationAction) => {
      const preference =
        confirmation.kind === 'markdown_document'
          ? 'markdown_document'
          : confirmation.kind === 'web_app'
            ? 'web_app'
            : 'interactive_artifact';
      return send(
        '请根据前一条请求创建我确认的持久产物。',
        undefined,
        preference,
        'chat',
        confirmation,
      );
    },
    [send],
  );
  const sendDeepResearch = useCallback(
    (topic: string) => send(topic, undefined, 'auto', 'deep_research'),
    [send],
  );
  useEffect(() => {
    const askNode = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object') return;
      const node = detail as Record<string, unknown>;
      if (
        typeof node.nodeId !== 'string' ||
        typeof node.nodeLabel !== 'string' ||
        node.nodeId.length > 64 ||
        node.nodeLabel.length > 120
      )
        return;
      send(`请围绕思维导图节点“${node.nodeLabel}”进一步讲解。`);
    };
    window.addEventListener(MIND_MAP_ASK_NODE_EVENT, askNode);
    return () => window.removeEventListener(MIND_MAP_ASK_NODE_EVENT, askNode);
  }, [send]);
  return { sendLive, onArtifactConfirmation, sendDeepResearch };
}
