import type { CanvasResource } from '@educanvas/canvas-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCanvasResource,
  type CanvasResourceClientError,
} from './canvas-resource-client';
import { selectWebCanvasResourceRenderer } from './web-canvas-resource-registry';
import { CanvasResourceOpenGate } from './canvas-resource-open-gate';

export interface UseStudioOpenActions {
  readonly openSource: (assetId: string) => void;
  readonly openArtifact: (artifactId: string) => void;
}

export interface UseStudioOpenResult {
  readonly actions: UseStudioOpenActions;
  readonly pendingKind: 'source' | 'artifact' | null;
  readonly validationError: CanvasResourceClientError | null;
  readonly retry: () => void;
  readonly close: () => void;
}

interface OpenRequest {
  readonly resourceKind: 'source' | 'artifact';
  readonly resourceId: string;
}

function isAbortError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

/**
 * Studio 打开 Source/Artifact 前的统一资源验证。
 * 封装验证逻辑，避免在 workspace 中重复内联回调。
 */
export function useStudioOpenActions(input: {
  scopeKey: string;
  onSourceValid: (resource: CanvasResource) => void;
  onArtifactValid: (resource: CanvasResource) => void;
}): UseStudioOpenResult {
  const callbacksRef = useRef({
    onSourceValid: input.onSourceValid,
    onArtifactValid: input.onArtifactValid,
  });
  useEffect(() => {
    callbacksRef.current = {
      onSourceValid: input.onSourceValid,
      onArtifactValid: input.onArtifactValid,
    };
  }, [input.onArtifactValid, input.onSourceValid]);
  const [stateScopeKey, setStateScopeKey] = useState(input.scopeKey);
  const [pendingKind, setPendingKind] = useState<'source' | 'artifact' | null>(
    null,
  );
  const [validationError, setValidationError] =
    useState<CanvasResourceClientError | null>(null);
  const gateRef = useRef(new CanvasResourceOpenGate());
  const lastRequestRef = useRef<OpenRequest | null>(null);

  const validate = useCallback(
    async (request: OpenRequest) => {
      const activeRequest = gateRef.current.begin();
      lastRequestRef.current = request;
      setStateScopeKey(input.scopeKey);
      setPendingKind(request.resourceKind);
      setValidationError(null);
      const { resourceKind, resourceId } = request;
      try {
        const resource = await fetchCanvasResource(resourceKind, resourceId, {
          signal: activeRequest.signal,
        });
        if (!gateRef.current.isCurrent(activeRequest.token)) return;
        const selection = selectWebCanvasResourceRenderer(resource);
        if (selection.kind === 'unavailable') {
          setPendingKind(null);
          setValidationError({
            kind: 'unavailable',
            message: '该资源没有可用的渲染器。',
          });
          return;
        }
        setPendingKind(null);
        if (resourceKind === 'source') {
          callbacksRef.current.onSourceValid(resource);
        } else {
          callbacksRef.current.onArtifactValid(resource);
        }
      } catch (err: unknown) {
        if (
          !gateRef.current.isCurrent(activeRequest.token) ||
          isAbortError(err)
        )
          return;
        setPendingKind(null);
        setValidationError(
          err && typeof err === 'object' && 'kind' in err && 'message' in err
            ? (err as CanvasResourceClientError)
            : { kind: 'failed', message: '验证资源时出现未知错误。' },
        );
      }
    },
    [input.scopeKey],
  );

  const openSource = useCallback(
    (assetId: string) => {
      void validate({ resourceKind: 'source', resourceId: assetId });
    },
    [validate],
  );

  const openArtifact = useCallback(
    (artifactId: string) => {
      void validate({ resourceKind: 'artifact', resourceId: artifactId });
    },
    [validate],
  );

  const close = useCallback(() => {
    gateRef.current.cancel();
    lastRequestRef.current = null;
    setPendingKind(null);
    setValidationError(null);
  }, []);

  const retry = useCallback(() => {
    const request = lastRequestRef.current;
    if (request) void validate(request);
  }, [validate]);

  useEffect(() => {
    const gate = gateRef.current;
    gate.cancel();
    lastRequestRef.current = null;
    return () => {
      gate.cancel();
    };
  }, [input.scopeKey]);

  const stateBelongsToCurrentScope = stateScopeKey === input.scopeKey;
  return {
    actions: { openSource, openArtifact },
    pendingKind: stateBelongsToCurrentScope ? pendingKind : null,
    validationError: stateBelongsToCurrentScope ? validationError : null,
    retry,
    close,
  };
}
