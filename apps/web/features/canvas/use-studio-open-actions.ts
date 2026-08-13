import type { CanvasResource } from '@educanvas/canvas-protocol';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import {
  fetchCanvasResource,
  type CanvasResourceClientError,
} from './canvas-resource-client';
import { selectWebCanvasResourceRenderer } from './web-canvas-resource-registry';
import { CanvasResourceOpenGate } from './canvas-resource-open-gate';
import { isShellRenderedArtifactResource } from './artifact-shell-rendering';
import type { CanvasResourceRendererProps } from './canvas-resource-registry';

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
  onSourceValid: (
    resource: CanvasResource,
    Renderer: ComponentType<CanvasResourceRendererProps>,
  ) => void;
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
  const currentScopeKeyRef = useRef(input.scopeKey);
  const lastRequestRef = useRef<OpenRequest | null>(null);

  const validate = useCallback(
    async (request: OpenRequest) => {
      const activeRequest = gateRef.current.begin(input.scopeKey);
      lastRequestRef.current = request;
      setStateScopeKey(input.scopeKey);
      setPendingKind(request.resourceKind);
      setValidationError(null);
      const { resourceKind, resourceId } = request;
      try {
        const resource = await fetchCanvasResource(resourceKind, resourceId, {
          signal: activeRequest.signal,
        });
        if (
          !gateRef.current.isCurrent(activeRequest, currentScopeKeyRef.current)
        )
          return;
        if (!resource.allowedActions.includes('view')) {
          setPendingKind(null);
          setValidationError({
            kind: 'unavailable',
            message: '当前没有查看该资源的权限。',
          });
          return;
        }
        if (
          resourceKind === 'artifact' &&
          isShellRenderedArtifactResource(resource)
        ) {
          /* 交互式产物（note/dom_exploration）由 ArtifactCanvas 壳显式渲染，
             Registry 无对应条目（W04-4）；验证通过即放行到壳，不判不可用。 */
          setPendingKind(null);
          callbacksRef.current.onArtifactValid(resource);
          return;
        }
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
          callbacksRef.current.onSourceValid(resource, selection.Renderer);
        } else {
          callbacksRef.current.onArtifactValid(resource);
        }
      } catch (err: unknown) {
        if (
          !gateRef.current.isCurrent(
            activeRequest,
            currentScopeKeyRef.current,
          ) ||
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

  useLayoutEffect(() => {
    currentScopeKeyRef.current = input.scopeKey;
    const gate = gateRef.current;
    gate.cancel();
    lastRequestRef.current = null;
  }, [input.scopeKey]);

  useEffect(() => {
    const gate = gateRef.current;
    return () => {
      gate.cancel();
    };
  }, []);

  const stateBelongsToCurrentScope = stateScopeKey === input.scopeKey;
  return {
    actions: { openSource, openArtifact },
    pendingKind: stateBelongsToCurrentScope ? pendingKind : null,
    validationError: stateBelongsToCurrentScope ? validationError : null,
    retry,
    close,
  };
}
