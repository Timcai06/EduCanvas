'use client';

import { type ObservableArtifactKind } from '@/features/canvas/artifact-client';
import type {
  ConfirmArtifactOptions,
  ProposedArtifact,
} from '@/features/canvas/artifact-generation-flow';
import type { TeachingTurnEvent } from '@/features/chat/turn-events';
import { useCallback, useRef } from 'react';

const AGENT_ARTIFACT_KINDS = new Set<ObservableArtifactKind>([
  'mind_map',
  'slides',
  'flashcards',
  'markdown_document',
  'note',
  'web_app',
  'audio_overview',
  'generated_image',
]);

function isAgentArtifactKind(kind: string): kind is ObservableArtifactKind {
  return AGENT_ARTIFACT_KINDS.has(kind as ObservableArtifactKind);
}

/**
 * 把 Agent 的 artifact.proposed 事件接回当前 Notebook UI。
 * SSE 只负责提示已有任务；轮询仍是断线可恢复的事实读取路径。
 */
export function useAgentArtifactEvents(input: {
  shouldOpenWhenReady: () => boolean;
  onArtifactChanged: () => void | Promise<unknown>;
  observeProposedArtifact: (
    artifact: ProposedArtifact,
    options?: ConfirmArtifactOptions,
  ) => Promise<void>;
}) {
  const { shouldOpenWhenReady, onArtifactChanged, observeProposedArtifact } =
    input;
  const observing = useRef(new Set<string>());
  return useCallback(
    (
      event: Extract<
        TeachingTurnEvent,
        { type: 'artifact.proposed' | 'artifact.created' }
      >,
    ) => {
      if (!isAgentArtifactKind(event.kind)) return;
      if (observing.current.has(event.artifactId)) return;
      observing.current.add(event.artifactId);
      void onArtifactChanged();
      void observeProposedArtifact(
        {
          artifactId: event.artifactId,
          kind: event.kind,
          title: event.title,
        },
        { openWhenReady: shouldOpenWhenReady() },
      ).finally(() => {
        observing.current.delete(event.artifactId);
        void onArtifactChanged();
      });
    },
    [observeProposedArtifact, onArtifactChanged, shouldOpenWhenReady],
  );
}
