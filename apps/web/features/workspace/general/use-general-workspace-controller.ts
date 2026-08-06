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
import type { AssetStatusNotice } from '@/features/assets/asset-status';
import { useArtifactGeneration } from '@/features/canvas/artifact-generation-flow';
import {
  fetchNotebookArtifacts,
  type ArtifactDetail,
  type ArtifactSummary,
} from '@/features/canvas/artifact-client';
import { useStudioOpenActions } from '@/features/canvas/use-studio-open-actions';
import { useOnlineStatus } from '@/features/chat/use-online-status';
import { useAgentTurn } from '@/features/chat/use-teaching-turn';
import type { InitialChatMessageDTO } from '@/features/chat/messages';
import type { PlusMenuActionId } from '@/features/composer/plus-menu';
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
import {
  PENDING_GENERAL_MENU_ACTION_KEY,
  PENDING_GENERAL_PROMPT_KEY,
  PENDING_GENERAL_CANVAS_KEY,
} from './general-chat-entry';
import { useAgentArtifactEvents } from './use-agent-artifact-events';

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
  nickname?: string | null;
  composerDockRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  nearBottom: RefObject<boolean>;
}) {
  const {
    initialMessages,
    conversationId,
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
  const [canvasSelected, setCanvasSelected] = useState(false);
  const [assetPanel, setAssetPanel] = useState<AssetItem['kind'] | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    canvasSelected,
    setCanvasSelected,
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

  const flipStateRef = useRef<Flip.FlipState | null>(null);
  const pendingConsumed = useRef(false);
  const pendingMenuConsumed = useRef(false);
  const pendingToolsConsumed = useRef(false);

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
    (text: string) => {
      setError(null);
      setSourceNotice(null);
      /* Flip 三段式:状态翻转前捕获输入坞位置,渲染后由组合层 useGSAP 播放位移。 */
      if (turn.messages.length === 0 && composerDockRef.current) {
        flipStateRef.current = Flip.getState(composerDockRef.current);
      }
      const selected = assets.flatMap((asset) =>
        asset.enabled && asset.versionId
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
      void turn
        .send(
          text,
          undefined,
          selected,
          canvasSelected ? { outputPreference: 'canvas' } : {},
        )
        .then((accepted) => {
          if (!accepted) return;
          if (canvasSelected) setCanvasSelected(false);
          setAssets((current) =>
            current.map((asset) =>
              asset.scope === 'turn' ? { ...asset, enabled: false } : asset,
            ),
          );
          void refreshAssets().catch(() => undefined);
        });
    },
    [
      assets,
      canvasSelected,
      composerDockRef,
      flipStateRef,
      refreshAssets,
      setAssets,
      turn,
    ],
  );

  useEffect(() => {
    if (pendingConsumed.current) return;
    pendingConsumed.current = true;
    const prompt = sessionStorage.getItem(PENDING_GENERAL_PROMPT_KEY);
    if (!prompt) return;
    sessionStorage.removeItem(PENDING_GENERAL_PROMPT_KEY);
    queueMicrotask(() => send(prompt));
  }, [send]);

  const handleMenuAction = useCallback(
    (action: PlusMenuActionId) => {
      if (action === 'upload_file') setAssetPanel('document');
      else if (action === 'upload_image') setAssetPanel('image');
      else if (action === 'add_link') setAssetPanel('link');
      else if (action === 'create_mind_map') {
        artifactFlow.beginConfirm('mind_map', '对话思维导图');
      } else if (action === 'create_slides') {
        artifactFlow.beginConfirm('slides', '对话小结 Slides');
      } else if (action === 'create_flashcards') {
        artifactFlow.beginConfirm('flashcards', '复习闪卡');
      } else if (action === 'create_audio_overview') {
        artifactFlow.beginConfirm('audio_overview', '来源音频概览');
      } else if (action === 'create_note') {
        artifactFlow.beginConfirm('note', '对话笔记');
      }
    },
    [artifactFlow],
  );

  useEffect(() => {
    if (pendingMenuConsumed.current) return;
    pendingMenuConsumed.current = true;
    const action = sessionStorage.getItem(
      PENDING_GENERAL_MENU_ACTION_KEY,
    ) as PlusMenuActionId | null;
    if (!action) return;
    sessionStorage.removeItem(PENDING_GENERAL_MENU_ACTION_KEY);
    queueMicrotask(() => handleMenuAction(action));
  }, [handleMenuAction]);

  useEffect(() => {
    if (pendingToolsConsumed.current) return;
    pendingToolsConsumed.current = true;
    const restoreCanvas = Boolean(
      sessionStorage.getItem(PENDING_GENERAL_CANVAS_KEY),
    );
    sessionStorage.removeItem(PENDING_GENERAL_CANVAS_KEY);
    queueMicrotask(() => {
      if (restoreCanvas) setCanvasSelected(true);
    });
  }, []);

  const openStudio = useCallback(() => {
    workspace.openStudio();
    void fetchNotebookArtifacts()
      .then(setStudioItems)
      .catch(() => setStudioItems([]));
  }, [workspace]);

  const online = useOnlineStatus();
  const isLanding = turn.messages.length === 0;
  const notebookSources = assets.filter((asset) => asset.scope === 'space');
  const composerTools = [
    { id: 'canvas' as const, label: 'Canvas', selected: canvasSelected },
  ];
  const handleToolAction = useCallback(() => {
    setCanvasSelected((selected) => !selected);
  }, []);
  const selectedAudioSources = selectAudioArtifactSources(notebookSources);
  const revisingOpenArtifact = isArtifactRevisionInProgress(artifactFlow);

  /* W02：landing 与对话共享同一组 ConversationPane props（两态只差 isLanding）。 */
  const conversationPaneProps = {
    nickname,
    messages: turn.messages,
    busy: turn.busy,
    stopAvailable: turn.stopAvailable,
    statusText: turn.statusText ?? error ?? sourceNotice?.message ?? null,
    statusTone: (!turn.busy && (error || sourceNotice?.tone === 'error')
      ? 'error'
      : 'info') as 'info' | 'error',
    generation: artifactFlow.generation,
    revisingOpenArtifact,
    composerTools,
    composerDockRef,
    scrollRef,
    nearBottomRef: nearBottom,
    onSend: send,
    onStop: () => void turn.stop(),
    onMenuAction: handleMenuAction,
    onToolAction: handleToolAction,
    onRetry: (messageId: string) => turn.retry(messageId),
    onPreviewHtml: (source: string) => workspace.openHtml(source),
    onOpenArtifact: (artifactId: string) =>
      studioOpenActions.actions.openArtifact(artifactId),
    onOpenStatusCard: (artifactId: string) =>
      studioOpenActions.actions.openArtifact(artifactId),
    onDismissStatusCard: artifactFlow.dismiss,
  } satisfies Omit<ConversationPaneProps, 'isLanding'>;

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
    canvasSelected,
    setCanvasSelected,
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
    handleToolAction,
    closeArtifactCanvas,
    handleArtifactDeleted,
    isLanding,
    notebookSources,
    composerTools,
    selectedAudioSources,
    revisingOpenArtifact,
    conversationPaneProps,
    surfaceSlotProps,
  };
}
