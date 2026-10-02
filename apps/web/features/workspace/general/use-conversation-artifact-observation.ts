'use client';

import { useEffect, useRef } from 'react';
import { fetchArtifactDetail } from '@/features/canvas/artifact-client';
import type { GenerationState } from '@/features/canvas/artifact-generation-flow';
import { projectObservedConversationArtifact } from './conversation-artifact-observation';
import type { ChatMessage, MessageArtifactDTO } from '@/features/chat/messages';
import {
  createConversationArtifactObserver,
  conversationArtifactReferences,
} from './conversation-artifact-observer';

/** Historic and live cards share observation without changing the Canvas selection. */
export function useConversationArtifactObservation(
  messages: readonly ChatMessage[],
  onObserved: (artifact: MessageArtifactDTO) => void,
  generation: GenerationState | null,
) {
  const observer = useRef<ReturnType<
    typeof createConversationArtifactObserver
  > | null>(null);
  const callback = useRef(onObserved);
  const references = useRef(conversationArtifactReferences(messages));
  useEffect(() => {
    callback.current = onObserved;
  }, [onObserved]);
  useEffect(() => {
    const next = createConversationArtifactObserver({
      fetchDetail: (id, signal) =>
        fetchArtifactDetail(id, undefined, { signal }),
      onObserved: (artifact) => callback.current(artifact),
    });
    observer.current = next;
    const resume = () => {
      if (document.visibilityState === 'visible')
        next.sync(references.current, true);
    };
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
      next.dispose();
      observer.current = null;
    };
  }, []);
  useEffect(() => {
    references.current = conversationArtifactReferences(messages);
    observer.current?.sync(references.current);
  }, [messages]);
  useEffect(() => {
    const observed = projectObservedConversationArtifact(generation);
    if (observed) onObserved(observed);
  }, [generation, onObserved]);
}
