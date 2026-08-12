'use client';

import {
  fetchNotebookArtifacts,
  type ArtifactSummary,
  type ObservableArtifactKind,
} from '@/features/canvas/artifact-client';
import type {
  ConfirmArtifactOptions,
  ProposedArtifact,
} from '@/features/canvas/artifact-generation-flow';
import type { TeachingTurnEvent } from '@/features/chat/turn-events';
import { type Dispatch, type SetStateAction, useCallback } from 'react';

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
  canvasSelected: boolean;
  setCanvasSelected: Dispatch<SetStateAction<boolean>>;
  setStudioItems: Dispatch<SetStateAction<readonly ArtifactSummary[]>>;
  observeProposedArtifact: (
    artifact: ProposedArtifact,
    options?: ConfirmArtifactOptions,
  ) => Promise<void>;
}) {
  const {
    canvasSelected,
    setCanvasSelected,
    setStudioItems,
    observeProposedArtifact,
  } = input;
  return useCallback(
    (
      event: Extract<
        TeachingTurnEvent,
        { type: 'artifact.proposed' | 'artifact.created' }
      >,
    ) => {
      if (!isAgentArtifactKind(event.kind)) return;
      void observeProposedArtifact(
        {
          artifactId: event.artifactId,
          kind: event.kind,
          title: event.title,
        },
        { openWhenReady: canvasSelected },
      );
      void fetchNotebookArtifacts()
        .then(setStudioItems)
        .catch(() => undefined);
      if (canvasSelected) setCanvasSelected(false);
    },
    [
      canvasSelected,
      observeProposedArtifact,
      setCanvasSelected,
      setStudioItems,
    ],
  );
}
