'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Flip } from 'gsap/Flip';
import type { AssetItem } from '@/features/assets/assets-drawer';
import { uploadWorkspaceSource } from '@/features/assets/source-intake';
import type { AssetStatusNotice } from '@/features/assets/asset-status';
import { useArtifactGeneration } from '@/features/canvas/artifact-generation-flow';
import {
  createArtifact,
  fetchNotebookArtifacts,
  type ArtifactDetail,
  type ArtifactSummary,
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
import { MIND_MAP_ASK_NODE_EVENT } from '@/features/canvas/mind-map-layout';

/**
 * `GeneralChatWorkspace` 的控制器（W02）。
 *
 * 聚合请求（turn/sources/studio 验证）、会话恢复（sessionStorage 三个 pending 键）、
 * 状态转换（surface 判别联合 + 各工作面详情），返回组合层需要的全部数据与动作，
 * 让主组件只负责 JSX 组装。DOM 引用（composerDock/scroll/nearBottom）由组合层创建
 * 后传入，供 send 的 Flip 捕获与滚动跟随使用；`flipStateRef` 由本控制器持有，
 * 组合层的 useGSAP 播放落地 → 对话位移。
 */
export function useGeneralWorkspaceController(options: {
  initialMessages: readonly InitialChatMessageDTO[];
  conversationId: string;
  notebookId: string;
  nickname?: string | null;
  composerDockRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  nearBottom: RefObject<boolean>;
}) {
  const {
    initialMessages,
    conversationId,
    notebookId,
    nickname,
    composerDockRef,
    scrollRef,
    nearBottom,
  } = options;

  const workspace = useWorkspaceSurface();
  const { surface } = workspace;
  const [sourceDetail, setSourceDetail] = useState<SourceSurfaceDetail | null>(
    null,
  );
  const [studioItems, setStudioItems] = useState<readonly ArtifactSummary[]>(
    [],
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

  const artifactFlow = useArtifactGeneration();
  const closeArtifactCanvas = useCallback(() => {
    workspace.dispatch({ type: 'close' });
    artifactFlow.closeCanvas();
  }, [artifactFlow, workspace]);
  const handleArtifactDeleted = useCallback(
    (artifactId: string) => {
      closeArtifactCanvas();
      setStudioItems((items) => items.filter((item) => item.id !== artifactId));
    },
    [closeArtifactCanvas],
  );

  const handleArtifactProposed = useAgentArtifactEvents({
    shouldOpenWhenReady: () => activeTurnOutputPreferenceRef.current !== 'auto',
    setStudioItems,
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

  const resourceDock = useResourceDock(notebookId);

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

  const flipStateRef = useRef<Flip.FlipState | null>(null);
  const pendingMenuConsumed = useRef(false);

  const sources = useNotebookSources({
    endpoint: GENERAL_ASSET_ENDPOINT,
    onError: setError,
    onStatus: setSourceNotice,
  });
  const { assets, setAssets } = sources;
  const refreshAssets = sources.refresh;

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
    ) => {
      setError(null);
      setSourceNotice(null);
      /* Flip 三段式:状态翻转前捕获输入坞位置,渲染后由组合层 useGSAP 播放位移。 */
      if (turn.messages.length === 0 && composerDockRef.current) {
        flipStateRef.current = Flip.getState(composerDockRef.current);
      }
      const selected = (frozenAssets ?? assets).flatMap((asset) =>
        asset.enabled &&
        asset.versionId &&
        (asset.kind === 'image' || asset.kind === 'document')
          ? [
              {
                type: 'asset_ref' as const,
                reference: {
                  assetId: asset.id,
                  versionId: asset.versionId,
                  kind: asset.kind,
                },
                /* usage 跟随 scope：笔记本长期来源是背景上下文，只在 Studio 里管理；
                   仅本轮的附件才属于这条消息，会在气泡里留痕。此前一律写死
                   'context'，导致每条提问都把全部来源重新盖一遍章。 */
                usage:
                  asset.scope === 'space'
                    ? ('context' as const)
                    : ('attachment' as const),
                label: asset.label,
              },
            ]
          : [],
      );
      activeTurnOutputPreferenceRef.current = preference;
      void turn
        .send(text, undefined, selected, {
          outputPreference: preference,
        })
        .then((accepted) => {
          if (!accepted) return;
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
      assets,
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
          setStudioItems((items) => [
            artifact,
            ...items.filter((item) => item.id !== artifact.id),
          ]);
          studioOpenActions.actions.openArtifact(artifact.id);
        })
        .catch((reason: unknown) => {
          setError(toClientError(reason, '会话信笺保存失败。'));
        });
    },
    [studioOpenActions],
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

  /* W03：作品列表加载失败不转成空列表——保留已有项并把失败语义上报到错误状态。 */
  const openStudio = useCallback(() => {
    workspace.openStudio();
    void fetchNotebookArtifacts()
      .then((items) => {
        setStudioItems(items);
        setError(null);
      })
      .catch((reason: unknown) => {
        setError(toClientError(reason, '暂时无法加载作品列表。'));
      });
  }, [workspace]);

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
          return [
            {
              ...asset,
              enabled:
                asset.selectable && enabledCount < MAX_LIVE_CONTEXT_ASSETS,
            },
            ...current.filter((item) => item.id !== asset.id),
          ];
        });
      } catch (reason: unknown) {
        setError(toClientError(reason, '文件上传暂时不可用。'));
        throw reason;
      }
    },
    [setAssets],
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
    onRetry: (messageId: string) => turn.retry(messageId),
    onPreviewHtml: (source: string) => workspace.openHtml(source),
    onOpenArtifact: (artifactId: string) =>
      studioOpenActions.actions.openArtifact(artifactId),
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
    studioItems,
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
