'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Flip } from 'gsap/Flip';
import type { AssetItem } from '@/features/assets/assets-drawer';
import { uploadWorkspaceSource } from '@/features/assets/source-intake';
import type { AssetStatusNotice } from '@/features/assets/asset-status';
import { useArtifactGeneration } from '@/features/canvas/artifact-generation-flow';
import type { GenerationPhase } from '@/features/canvas/artifact-generation-flow';
import {
  createArtifact,
  type ArtifactDetail,
} from '@/features/canvas/artifact-client';
import { useStudioOpenActions } from '@/features/canvas/use-studio-open-actions';
import { useOnlineStatus } from '@/features/chat/use-online-status';
import { useAgentTurn } from '@/features/chat/use-teaching-turn';
import type { InitialChatMessageDTO } from '@/features/chat/messages';
import type { PlusMenuActionId } from '@/features/composer/plus-menu';
import {
  MAX_LIVE_CONTEXT_ASSETS,
  type LiveVoiceContextAsset,
  type LiveVoiceContextSnapshot,
} from '@/features/voice/live-voice-context';
import {
  formatLiveVoiceLetterMarkdown,
  type LiveVoiceExitPayload,
} from '@/features/voice/live-voice-bring-back';
import { useNotebookSources } from './use-notebook-sources';
import { useWorkspaceSurface } from './use-workspace-surface';
import type { HomeFocusTarget } from './home-focus';
import {
  isArtifactRevisionInProgress,
  selectAudioArtifactSources,
} from './general-artifact-selection';
import type {
  SourceSurfaceDetail,
  WorkspaceSurfaceSlotProps,
} from './workspace-surface-slot';
import type { ConversationPaneProps } from './conversation-pane';
import {
  GENERAL_ASSET_ENDPOINT,
  GENERAL_TURN_OPTIONS,
} from './general-chat-config';
import type { OutputPreference } from '@educanvas/agent-core';
import {
  pendingGeneralTurnLegacyKeys,
  pendingGeneralTurnReadKeys,
  PENDING_GENERAL_TURN_KEY,
  restorePendingGeneralTurn,
} from './pending-general-turn';
import { useAgentArtifactEvents } from './use-agent-artifact-events';
import { shouldOpenArtifactSurface } from './artifact-detail-surface-sync';
import {
  ResourceClientError,
  toClientError,
} from '@/features/canvas/resource-error';
import { saveResourceAnnotation } from '@/features/canvas/resource-annotation-client';
import { useSurfacePositionPersistence } from './use-surface-position-persistence';
import { useResourceDock } from './use-resource-dock';
import { showToast } from '@/components/ui/toast';
import { buildTurnContextSnapshot } from '@/features/chat/turn-context-snapshot';
import { MIND_MAP_ASK_NODE_EVENT } from '@/features/canvas/mind-map-layout';
import { shouldConsumeTurnScopedInputs } from './turn-input-consumption';
import { describeGenerationSettledToast } from './generation-toast';

/**
 * `GeneralChatWorkspace` 的控制器（W02）。
 *
 * 聚合请求、会话恢复与工作面状态，返回组合层需要的数据和动作。
 * DOM 引用由组合层传入；`flipStateRef` 由本控制器持有，播放落地 → 对话位移。
 */
export function useGeneralWorkspaceController(options: {
  initialMessages: readonly InitialChatMessageDTO[];
  conversationId: string;
  notebookId: string;
  nickname?: string | null;
  deepResearchUnavailableReason?: string | null;
  /** DP08 Web handoff 落点：`?focus=<kind>:<id>` 解析后的精确资源目标。 */
  focusTarget?: HomeFocusTarget | null;
  composerDockRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  nearBottom: RefObject<boolean>;
}) {
  const {
    initialMessages,
    conversationId,
    notebookId,
    nickname,
    deepResearchUnavailableReason,
    focusTarget,
    composerDockRef,
    scrollRef,
    nearBottom,
  } = options;

  const workspace = useWorkspaceSurface();
  const { surface } = workspace;
  const [sourceDetail, setSourceDetail] = useState<SourceSurfaceDetail | null>(
    null,
  );
  const [outputPreference, setOutputPreference] =
    useState<OutputPreference>('auto');
  const activeTurnOutputPreferenceRef = useRef<OutputPreference>('auto');
  const [assetPanel, setAssetPanel] = useState<AssetItem['kind'] | null>(null);
  /* W03：来源加载/变更错误保留结构化语义，UI 据此决定可重试性与文案。 */
  const [error, setError] = useState<ResourceClientError | null>(null);
  const [sourceNotice, setSourceNotice] = useState<AssetStatusNotice | null>(
    null,
  );

  const resourceDock = useResourceDock(notebookId);
  const { reload: reloadResourceDock } = resourceDock;
  /* onSettled 引用保持稳定（reload 依赖 [notebookId, requestPage]），
     避免轮询/观察链随每次渲染重建失效。 */
  const refreshResourceDock = useCallback(
    () => void reloadResourceDock(),
    [reloadResourceDock],
  );
  const artifactFlow = useArtifactGeneration({
    onSettled: refreshResourceDock,
  });
  const closeArtifactCanvas = useCallback(() => {
    workspace.dispatch({ type: 'close' });
    artifactFlow.closeCanvas();
  }, [artifactFlow, workspace]);
  const handleArtifactDeleted = useCallback(() => {
    closeArtifactCanvas();
    void resourceDock.reload();
  }, [closeArtifactCanvas, resourceDock]);

  const handleArtifactProposed = useAgentArtifactEvents({
    shouldOpenWhenReady: () => activeTurnOutputPreferenceRef.current !== 'auto',
    onArtifactChanged: resourceDock.reload,
    observeProposedArtifact: artifactFlow.observeProposedArtifact,
  });
  const turn = useAgentTurn(initialMessages, GENERAL_TURN_OPTIONS, {
    onArtifactProposed: handleArtifactProposed,
  });

  const studioOpenActions = useStudioOpenActions({
    scopeKey: conversationId,
    onSourceValid: (resource, Renderer) => {
      /* 验证成功后才开 surface：先缓存详情再 dispatch，渲染时 detail 与 surface 同步就绪。 */
      setSourceDetail({ resource, Renderer });
      workspace.openSource(resource.resourceId);
    },
    onArtifactValid: (resource) => {
      workspace.openArtifact(resource.resourceId);
      void artifactFlow.openArtifact(resource.resourceId);
    },
  });

  const {
    positions: surfacePositions,
    openRestingSurface,
    error: surfacePositionError,
  } = useSurfacePositionPersistence({
    notebookId,
    surface,
    openSource: studioOpenActions.actions.openSource,
    openArtifact: studioOpenActions.actions.openArtifact,
  });

  /* Artifact 详情新打开时同步 surface：`artifactFlow.confirm`（openWhenReady）与
     `observeProposedArtifact` 只在 artifactFlow 内部 setOpenDetail，不会 dispatch
     surface；这里补上单一资源打开语义，避免 openDetail 有值但 surface 未进入 artifact。 */
  const prevOpenDetailRef = useRef<ArtifactDetail | null>(null);
  useEffect(() => {
    const detail = artifactFlow.openDetail;
    if (shouldOpenArtifactSurface(prevOpenDetailRef.current, detail)) {
      workspace.openArtifact(detail.artifact.id);
    }
    prevOpenDetailRef.current = detail;
  }, [artifactFlow.openDetail, workspace]);

  /* DP08 Web handoff 落点：mount 时按 `?focus=<kind>:<id>` 打开精确资源并清掉 URL
     参数（ref 防 StrictMode 双发；openSource/openArtifact 是稳定 useCallback，只跑一次；
     无效/过期 id 由 useStudioOpenActions 校验 + CanvasResourceOpenStatus 重试 UI 兜底）。 */
  const focusFiredRef = useRef(false);
  useEffect(() => {
    if (!focusTarget || focusFiredRef.current) return;
    focusFiredRef.current = true;
    if (focusTarget.kind === 'source') {
      studioOpenActions.actions.openSource(focusTarget.resourceId);
    } else {
      studioOpenActions.actions.openArtifact(focusTarget.resourceId);
    }
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('focus')) {
        url.searchParams.delete('focus');
        window.history.replaceState(null, '', url.toString());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget]);

  /* 生成完成/失败 toast：只在 generating→终态转换时通知一次，刷新页面不重放。
     本地取消（cancelled）不通知——任务仍在后台运行。 */
  const prevGenerationPhaseRef = useRef<GenerationPhase | undefined>(undefined);
  useEffect(() => {
    const generation = artifactFlow.generation;
    const phase = generation?.phase;
    const previous = prevGenerationPhaseRef.current;
    prevGenerationPhaseRef.current = phase;
    if (previous !== 'generating' || !generation) return;
    const spec = describeGenerationSettledToast(generation);
    if (!spec) return;
    showToast({
      ...spec,
      ...(spec.actionLabel && generation.artifactId
        ? {
            onAction: () => {
              const artifactId = generation.artifactId;
              if (artifactId) {
                studioOpenActions.actions.openArtifact(artifactId);
              }
            },
          }
        : {}),
    });
  }, [artifactFlow.generation, studioOpenActions]);

  const flipStateRef = useRef<Flip.FlipState | null>(null);
  const pendingMenuConsumed = useRef(false);

  const sources = useNotebookSources({
    endpoint: GENERAL_ASSET_ENDPOINT,
    onError: setError,
    onStatus: setSourceNotice,
    onSettled: refreshResourceDock,
  });
  const { assets, setAssets } = sources;
  const refreshAssets = sources.refresh;
  const assetsRef = useRef(assets);
  useLayoutEffect(() => {
    assetsRef.current = assets;
  }, [assets]);
  /* 消息列跟随新消息滚底；用户上翻阅读时不打断（nearBottom 由组合层滚动容器更新）。 */
  useEffect(() => {
    const container = scrollRef.current;
    if (container && nearBottom.current)
      container.scrollTop = container.scrollHeight;
  }, [nearBottom, scrollRef, turn.messages]);

  const send = useCallback(
    (
      text: string,
      frozenAssets?: readonly LiveVoiceContextAsset[],
      preference = outputPreference,
      mode: 'chat' | 'deep_research' = 'chat',
    ) => {
      setError(null);
      setSourceNotice(null);
      /* Flip 三段式:状态翻转前捕获输入坞位置,渲染后由组合层 useGSAP 播放位移。 */
      if (turn.messages.length === 0 && composerDockRef.current) {
        flipStateRef.current = Flip.getState(composerDockRef.current);
      }
      const snapshot = buildTurnContextSnapshot(
        frozenAssets ?? assetsRef.current,
      );
      const selected = snapshot.parts.map((part, index) => ({
        ...part,
        label: snapshot.included[index]!.label,
      }));
      activeTurnOutputPreferenceRef.current = preference;
      void turn
        .send(text, undefined, selected, {
          outputPreference: preference,
          mode,
        })
        .then((outcome) => {
          if (!shouldConsumeTurnScopedInputs(outcome)) return;
          setOutputPreference('auto');
          activeTurnOutputPreferenceRef.current = 'auto';
          setAssets((current) =>
            current.map((asset) =>
              asset.scope === 'turn' ? { ...asset, enabled: false } : asset,
            ),
          );
          /* W03：发送后刷新来源失败不静默吞掉——上报结构化错误，保留服务端已确认的数据。 */
          void refreshAssets().catch((reason: unknown) => {
            setError(toClientError(reason, '发送后刷新来源失败。'));
          });
        });
    },
    [
      outputPreference,
      composerDockRef,
      flipStateRef,
      refreshAssets,
      setAssets,
      turn,
    ],
  );
  const sendLive = useCallback(
    (text: string, context: LiveVoiceContextSnapshot) =>
      send(text, context.assets),
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
      ) {
        return;
      }
      send(`请围绕思维导图节点“${node.nodeLabel}”进一步讲解。`);
    };
    window.addEventListener(MIND_MAP_ASK_NODE_EVENT, askNode);
    return () => window.removeEventListener(MIND_MAP_ASK_NODE_EVENT, askNode);
  }, [send]);

  /* 出室带回：会话转录装订成 note 信笺落库，成功后摆上工作面。
     失败只上报错误——退场动画不依赖这次写库（门槛设计 §4）。 */
  const handleLiveExit = useCallback(
    (payload: LiveVoiceExitPayload) => {
      if (payload.annotations.length > 0) {
        void Promise.allSettled(
          payload.annotations.map((draft) =>
            saveResourceAnnotation({
              resourceKind: draft.resourceKind,
              resourceId: draft.resourceId,
              annotation: {
                kind: draft.kind,
                geometry: draft.geometry,
                source: 'voice',
                resourceVersionId: draft.resourceVersionId,
              },
            }),
          ),
        ).then((results) => {
          if (results.some((result) => result.status === 'rejected')) {
            setError(
              new ResourceClientError(
                'failed',
                '部分圈点暂时没有落纸，请稍后重试。',
              ),
            );
          }
        });
      }
      if (payload.sessionTranscript.length === 0) return;
      const endedAt = new Date(payload.endedAt);
      const pad = (value: number) => String(value).padStart(2, '0');
      const title = `Live Voice 信笺 ${pad(endedAt.getHours())}:${pad(endedAt.getMinutes())}`;
      const markdown = formatLiveVoiceLetterMarkdown(
        payload.sessionTranscript,
        payload.endedAt,
      );
      void createArtifact('note', title, [], markdown)
        .then(({ artifact }) => {
          void resourceDock.reload();
          studioOpenActions.actions.openArtifact(artifact.id);
        })
        .catch((reason: unknown) => {
          setError(toClientError(reason, '会话信笺保存失败。'));
        });
    },
    [resourceDock, studioOpenActions],
  );

  const handleMenuAction = useCallback((action: PlusMenuActionId) => {
    if (action === 'upload_file') setAssetPanel('document');
    else if (action === 'upload_image') setAssetPanel('image');
    else if (action === 'add_link') setAssetPanel('link');
  }, []);

  useEffect(() => {
    if (pendingMenuConsumed.current) return;
    pendingMenuConsumed.current = true;
    const restored = restorePendingGeneralTurn({
      current: sessionStorage.getItem(PENDING_GENERAL_TURN_KEY),
      legacyPrompt: sessionStorage.getItem(pendingGeneralTurnLegacyKeys.prompt),
      legacyMenuAction: sessionStorage.getItem(
        pendingGeneralTurnLegacyKeys.menuAction,
      ),
      legacyCanvas: sessionStorage.getItem(pendingGeneralTurnLegacyKeys.canvas),
      legacyOutputPreference: sessionStorage.getItem(
        pendingGeneralTurnLegacyKeys.outputPreference,
      ),
    });
    pendingGeneralTurnReadKeys.forEach((key) => sessionStorage.removeItem(key));
    if (restored.kind === 'turn') {
      queueMicrotask(() => {
        setOutputPreference(restored.payload.outputPreference);
        send(
          restored.payload.prompt,
          undefined,
          restored.payload.outputPreference,
        );
      });
    } else if (restored.kind === 'legacy_menu_action') {
      queueMicrotask(() =>
        handleMenuAction(restored.action as PlusMenuActionId),
      );
    }
  }, [handleMenuAction, send]);

  const openStudio = useCallback(() => {
    workspace.openStudio();
    void resourceDock.reload().then(resourceDock.loadAll);
  }, [resourceDock, workspace]);

  const online = useOnlineStatus();
  const isLanding = turn.messages.length === 0;
  const notebookSources = assets.filter((asset) => asset.scope === 'space');
  const composerTools = [] as const;
  const handleOutputPreferenceChange = useCallback(
    (preference: OutputPreference) => {
      setOutputPreference(preference);
    },
    [],
  );
  const selectedAudioSources = selectAudioArtifactSources(notebookSources);
  const revisingOpenArtifact = isArtifactRevisionInProgress(artifactFlow);
  const uploadLiveAsset = useCallback(
    async (file: File) => {
      try {
        const asset = await uploadWorkspaceSource({
          file,
          scope: 'space',
          endpoint: GENERAL_ASSET_ENDPOINT,
        });
        setAssets((current) => {
          const enabledCount = current.filter((item) => item.enabled).length;
          const next = [
            {
              ...asset,
              enabled:
                asset.selectable && enabledCount < MAX_LIVE_CONTEXT_ASSETS,
            },
            ...current.filter((item) => item.id !== asset.id),
          ];
          assetsRef.current = next;
          return next;
        });
        /* 新来源即刻进入 Dock 摘要，不必等下一轮手动刷新。 */
        void resourceDock.reload();
      } catch (reason: unknown) {
        setError(toClientError(reason, '文件上传暂时不可用。'));
        throw reason;
      }
    },
    [resourceDock, setAssets],
  );

  /* W02：landing 与对话共享同一组 ConversationPane props（两态只差 isLanding）。 */
  const conversationPaneProps = {
    nickname,
    messages: turn.messages,
    busy: turn.busy,
    stopAvailable: turn.stopAvailable,
    statusText:
      turn.statusText ?? error?.message ?? sourceNotice?.message ?? null,
    statusTone: (!turn.busy && (error || sourceNotice?.tone === 'error')
      ? 'error'
      : 'info') as 'info' | 'error',
    generation: artifactFlow.generation,
    revisingOpenArtifact,
    composerTools,
    outputPreference,
    liveAssets: assets,
    composerDockRef,
    scrollRef,
    nearBottomRef: nearBottom,
    onSend: send,
    onLiveSend: sendLive,
    onLiveExit: handleLiveExit,
    onStop: () => void turn.stop(),
    onMenuAction: handleMenuAction,
    onToolAction: () => undefined,
    onOutputPreferenceChange: handleOutputPreferenceChange,
    onDeepResearch: sendDeepResearch,
    deepResearchUnavailableReason,
    onRetry: (messageId: string) => turn.retry(messageId),
    onPreviewHtml: (source: string) => workspace.openHtml(source),
    onOpenArtifact: (artifactId: string) =>
      studioOpenActions.actions.openArtifact(artifactId),
    onOpenSource: (assetId: string) =>
      studioOpenActions.actions.openSource(assetId),
    onToggleLiveAsset: (assetId: string) => {
      const asset = assets.find((candidate) => candidate.id === assetId);
      if (!asset?.selectable) return;
      if (
        !asset.enabled &&
        assets.filter((candidate) => candidate.enabled).length >=
          MAX_LIVE_CONTEXT_ASSETS
      ) {
        setError(
          new ResourceClientError(
            'failed',
            `一轮最多同时带入 ${MAX_LIVE_CONTEXT_ASSETS} 份资料。`,
          ),
        );
        return;
      }
      sources.toggle(asset);
    },
    onUploadLiveAsset: uploadLiveAsset,
    onOpenStatusCard: (artifactId: string) =>
      studioOpenActions.actions.openArtifact(artifactId),
    onDismissStatusCard: artifactFlow.dismiss,
  } satisfies Omit<ConversationPaneProps, 'isLanding' | 'notebookId'>;

  /* W02：对话态分栏与 landing 全屏共用同一组槽位 props（只差 fullscreen）。 */
  const surfaceSlotProps = {
    surface,
    sourceDetail,
    artifactDetail: artifactFlow.openDetail,
    artifactCanvasFull: artifactFlow.canvasFull,
    revisingOpenArtifact,
    onToggleFullSurface: () => workspace.dispatch({ type: 'toggleFull' }),
    onToggleFullArtifact: () => artifactFlow.setCanvasFull((value) => !value),
    onCloseSurface: () => workspace.dispatch({ type: 'close' }),
    onCloseArtifact: closeArtifactCanvas,
    onDeletedArtifact: handleArtifactDeleted,
    onSelectArtifactVersion: (artifactId: string, version: number) =>
      void artifactFlow.openArtifactVersion(artifactId, version),
    onReviseArtifact: (detail: ArtifactDetail, instruction: string) =>
      void artifactFlow.revise(detail, instruction),
    onSaveNote: (detail: ArtifactDetail, markdown: string) =>
      void artifactFlow.saveNote(detail, markdown),
  } satisfies Omit<WorkspaceSurfaceSlotProps, 'fullscreen'>;

  return {
    surface,
    workspace,
    sourceDetail,
    outputPreference,
    setOutputPreference,
    assetPanel,
    setAssetPanel,
    setAssets,
    error,
    sourceNotice,
    turn,
    artifactFlow,
    studioOpenActions,
    sources,
    online,
    flipStateRef,
    send,
    openStudio,
    handleMenuAction,
    closeArtifactCanvas,
    handleArtifactDeleted,
    isLanding,
    notebookSources,
    composerTools,
    selectedAudioSources,
    revisingOpenArtifact,
    conversationPaneProps,
    surfaceSlotProps,
    surfacePositions,
    openRestingSurface,
    surfacePositionError,
    resourceDock,
  };
}
