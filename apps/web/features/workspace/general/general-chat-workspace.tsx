'use client';

import { startNewGeneralChatAction } from '@/app/actions';
import type { AssetItem } from '@/features/assets/assets-drawer';
import { AssetsDrawer } from '@/features/assets/assets-drawer';
import { loadAssets } from '@/features/assets/asset-client';
import { AssetUploadPanel } from '@/features/assets/asset-upload-panel';
import {
  ArtifactCanvas,
  ArtifactConfirmSheet,
  ArtifactStatusCard,
  useArtifactGeneration,
} from '@/features/canvas/artifact-generation-flow';
import {
  fetchNotebookArtifacts,
  type ArtifactSummary,
} from '@/features/canvas/artifact-client';
import { HtmlPreviewPanel } from '@/features/canvas/html-preview-panel';
import { ChatPanel } from '@/features/chat/chat-panel';
import { OfflineBanner } from '@/features/chat/offline-banner';
import { useOnlineStatus } from '@/features/chat/use-online-status';
import { useSidebarState } from './use-sidebar-state';
import type { InitialChatMessageDTO } from '@/features/chat/messages';
import {
  useAgentTurn,
  type AgentTurnClientOptions,
} from '@/features/chat/use-teaching-turn';
import { Composer } from '@/features/composer/composer';
import type { PlusMenuActionId } from '@/features/composer/plus-menu';
import { useGSAP } from '@gsap/react';
import { List, NotePencil } from '@phosphor-icons/react';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PENDING_GENERAL_MENU_ACTION_KEY,
  PENDING_GENERAL_PROMPT_KEY,
  PENDING_GENERAL_CANVAS_KEY,
} from './general-chat-entry';
import { ConversationSidebar } from './conversation-sidebar';
import { SourcesPanel } from './sources-panel';
import { HeroGreeting } from '../shared/hero-greeting';
import { LogoMark } from '../shared/logo-mark';
import { PromptSuggestions } from './prompt-suggestions';
import { Sheet } from '../shared/sheet';

gsap.registerPlugin(useGSAP, Flip);

const ASSET_ENDPOINT = '/api/v1/chat/assets';
const GENERAL_TURN_OPTIONS: AgentTurnClientOptions = {
  endpoint: '/api/v1/chat/turn',
  assistantLabel: 'AI',
  cancelEndpoint: (turnId) =>
    `/api/v1/chat/turn/${encodeURIComponent(turnId)}/cancel`,
};
const GENERAL_MENU_ACTIONS: readonly PlusMenuActionId[] = [
  'upload_file',
  'upload_image',
  'create_mind_map',
  'create_slides',
  'create_flashcards',
  'create_audio_overview',
];

export function GeneralChatWorkspace({
  initialMessages,
  conversationId,
  notebookTitle,
}: {
  initialMessages: readonly InitialChatMessageDTO[];
  conversationId: string;
  notebookTitle: string | null;
}) {
  const turn = useAgentTurn(initialMessages, GENERAL_TURN_OPTIONS);
  const [assets, setAssets] = useState<readonly AssetItem[]>([]);
  const [assetPanel, setAssetPanel] = useState<
    'assets' | AssetItem['kind'] | null
  >(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewFull, setPreviewFull] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioItems, setStudioItems] = useState<readonly ArtifactSummary[]>(
    [],
  );
  const artifactFlow = useArtifactGeneration();
  const [canvasSelected, setCanvasSelected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const flipStateRef = useRef<Flip.FlipState | null>(null);
  const nearBottom = useRef(true);
  const pendingConsumed = useRef(false);
  const pendingMenuConsumed = useRef(false);
  const pendingToolsConsumed = useRef(false);

  const refreshAssets = useCallback(async () => {
    const items = await loadAssets(ASSET_ENDPOINT, {
      enableSpaceByDefault: true,
    });
    setAssets((current) => {
      const enabledById = new Map(
        current.map((asset) => [asset.id, asset.enabled] as const),
      );
      return items.map((asset) => ({
        ...asset,
        enabled: enabledById.get(asset.id) ?? asset.enabled,
      }));
    });
  }, []);

  useEffect(() => {
    let active = true;
    void loadAssets(ASSET_ENDPOINT, { enableSpaceByDefault: true })
      .then((items) => {
        if (active) setAssets(items);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : '暂时无法读取资料。',
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (container && nearBottom.current)
      container.scrollTop = container.scrollHeight;
  }, [turn.messages]);

  const toggleAsset = useCallback((id: string) => {
    setAssets((current) =>
      current.map((asset) =>
        asset.id === id && asset.selectable
          ? { ...asset, enabled: !asset.enabled }
          : asset,
      ),
    );
  }, []);

  const send = useCallback(
    (text: string) => {
      setError(null);
      /* Flip 三段式:状态翻转前捕获输入坞位置,渲染后由下方 useGSAP 播放位移。 */
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
                usage: 'context' as const,
                label: asset.label,
              },
            ]
          : [],
      );
      void turn.send(text, undefined, selected).then((accepted) => {
        if (!accepted) return;
        setAssets((current) =>
          current.map((asset) =>
            asset.scope === 'turn' ? { ...asset, enabled: false } : asset,
          ),
        );
        void refreshAssets().catch(() => undefined);
      });
    },
    [assets, refreshAssets, turn],
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
      else if (action === 'create_mind_map') {
        artifactFlow.beginConfirm('mind_map', '对话思维导图');
      } else if (action === 'create_slides') {
        artifactFlow.beginConfirm('slides', '对话小结 Slides');
      } else if (action === 'create_flashcards') {
        artifactFlow.beginConfirm('flashcards', '复习闪卡');
      } else if (action === 'create_audio_overview') {
        artifactFlow.beginConfirm('audio_overview', '来源音频概览');
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

  const online = useOnlineStatus();
  const { open: sidebarOpen, toggle: toggleSidebar } = useSidebarState();
  const isLanding = turn.messages.length === 0;
  const notebookSources = assets.filter((asset) => asset.scope === 'space');
  const composerTools = [
    { id: 'canvas' as const, label: 'Canvas', selected: canvasSelected },
  ];
  const handleToolAction = useCallback(() => {
    setCanvasSelected((selected) => !selected);
  }, []);
  const selectedAudioSources = notebookSources.flatMap((asset) =>
    asset.enabled &&
    asset.versionId &&
    (asset.kind === 'document' || asset.kind === 'link')
      ? [
          {
            assetId: asset.id,
            versionId: asset.versionId,
            kind: asset.kind,
          } as const,
        ]
      : [],
  );
  const revisingOpenArtifact = Boolean(
    artifactFlow.openDetail &&
    ((artifactFlow.generation?.phase === 'generating' &&
      artifactFlow.generation.artifactId ===
        artifactFlow.openDetail.artifact.id) ||
      ['queued', 'running'].includes(
        artifactFlow.openDetail.latestJob?.status ?? '',
      )),
  );

  /* 落地 → 对话：输入坞 Flip 位移落到吸底位置；reduced-motion 直接跳变。 */
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const flipState = flipStateRef.current;
        if (flipState && !isLanding) {
          flipStateRef.current = null;
          Flip.from(flipState, {
            duration: 0.6,
            ease: 'power3.inOut',
            scale: false,
          });
        }
      });
      media.add('(prefers-reduced-motion: reduce)', () => {
        flipStateRef.current = null;
      });
      return () => media.revert();
    },
    { scope: mainRef, dependencies: [isLanding] },
  );

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="z-20 flex h-16 shrink-0 items-center gap-1.5 px-3 sm:px-4">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="笔记本列表"
          aria-expanded={sidebarOpen}
          title="笔记本列表"
          className="grid size-10 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <List size={19} weight="bold" />
        </button>
        {/* 始终可见的"新建"：无论侧栏收起与否，一键回到大搜索框首页开新会话 */}
        <button
          type="button"
          onClick={() => void startNewGeneralChatAction()}
          aria-label="新建笔记本"
          title="新建笔记本"
          className="grid size-10 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <NotePencil size={19} />
        </button>
        <span className="ml-1 inline-flex items-center gap-2.5 font-display text-base font-semibold">
          <LogoMark size={20} />
          <span className="hidden sm:inline">EduCanvas</span>
        </span>
        <span
          aria-hidden="true"
          className="hidden h-5 w-px bg-line/80 sm:block"
        />
        <span className="max-w-40 truncate text-sm font-medium text-ink-muted sm:max-w-64">
          {notebookTitle ?? '未命名笔记本'}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            setStudioOpen(true);
            void fetchNotebookArtifacts()
              .then(setStudioItems)
              .catch(() => setStudioItems([]));
          }}
          className="rounded-full px-4 py-2 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          Studio
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <ConversationSidebar
          open={sidebarOpen}
          onClose={toggleSidebar}
          activeConversationId={conversationId}
          onNewNotebook={() => void startNewGeneralChatAction()}
        >
          <SourcesPanel
            assets={notebookSources}
            onToggle={toggleAsset}
            onUpload={(kind) => setAssetPanel(kind)}
            onImported={(asset) =>
              setAssets((current) => [
                { ...asset, enabled: asset.selectable },
                ...current.filter((item) => item.id !== asset.id),
              ])
            }
          />
        </ConversationSidebar>
        <main
          ref={mainRef}
          className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {!online ? (
            <div className="relative z-10 shrink-0 pt-1">
              <OfflineBanner />
            </div>
          ) : null}
          {isLanding ? (
            <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center pb-14 text-center sm:pb-16">
              <HeroGreeting />
              <div ref={composerDockRef} className="w-full">
                {artifactFlow.generation &&
                artifactFlow.generation.phase !== 'confirm' ? (
                  <div className="px-4">
                    <ArtifactStatusCard
                      generation={artifactFlow.generation}
                      onOpen={() => {
                        const artifactId = artifactFlow.generation?.artifactId;
                        if (artifactId)
                          void artifactFlow.openArtifact(artifactId);
                      }}
                      onDismiss={artifactFlow.dismiss}
                      dismissable={!revisingOpenArtifact}
                    />
                  </div>
                ) : null}
                <Composer
                  chips={[]}
                  busy={turn.busy}
                  statusText={turn.statusText ?? error}
                  statusTone={error && !turn.busy ? 'error' : 'info'}
                  onSend={send}
                  onRemoveChip={() => undefined}
                  onMenuAction={handleMenuAction}
                  availableMenuActions={GENERAL_MENU_ACTIONS}
                  toolChips={composerTools}
                  onToolAction={handleToolAction}
                  variant="landing"
                />
              </div>
              <PromptSuggestions onPick={send} disabled={turn.busy} />
            </div>
          ) : (
            <div className="relative z-10 flex min-h-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div
                  ref={scrollRef}
                  className="min-h-0 flex-1 overflow-y-auto"
                  role="region"
                  aria-label="AI 对话"
                  onScroll={(event) => {
                    const node = event.currentTarget;
                    nearBottom.current =
                      node.scrollHeight - node.scrollTop - node.clientHeight <=
                      96;
                  }}
                >
                  <ChatPanel
                    messages={turn.messages}
                    canvasOpen={false}
                    artifactTitle=""
                    onOpenCanvas={() => undefined}
                    onContinueText={() => undefined}
                    onRetry={(messageId) => turn.retry(messageId)}
                    onPreviewHtml={({ source }) => setPreviewHtml(source)}
                    assistantLabel="AI"
                  />
                </div>
                <div ref={composerDockRef} className="relative z-10 px-4">
                  {artifactFlow.generation &&
                  artifactFlow.generation.phase !== 'confirm' ? (
                    <ArtifactStatusCard
                      generation={artifactFlow.generation}
                      onOpen={() => {
                        const artifactId = artifactFlow.generation?.artifactId;
                        if (artifactId)
                          void artifactFlow.openArtifact(artifactId);
                      }}
                      onDismiss={artifactFlow.dismiss}
                      dismissable={!revisingOpenArtifact}
                    />
                  ) : null}
                  <Composer
                    chips={[]}
                    busy={turn.busy}
                    statusText={turn.statusText ?? error}
                    statusTone={error && !turn.busy ? 'error' : 'info'}
                    onSend={send}
                    onRemoveChip={() => undefined}
                    onMenuAction={handleMenuAction}
                    availableMenuActions={GENERAL_MENU_ACTIONS}
                    toolChips={composerTools}
                    onToolAction={handleToolAction}
                  />
                </div>
              </div>
              {artifactFlow.openDetail ? (
                <ArtifactCanvas
                  detail={artifactFlow.openDetail}
                  isFull={artifactFlow.canvasFull}
                  onToggleFull={() =>
                    artifactFlow.setCanvasFull((value) => !value)
                  }
                  onClose={artifactFlow.closeCanvas}
                  onSelectVersion={(version) =>
                    void artifactFlow.openArtifactVersion(
                      artifactFlow.openDetail!.artifact.id,
                      version,
                    )
                  }
                  onRevise={(instruction) =>
                    void artifactFlow.revise(
                      artifactFlow.openDetail!,
                      instruction,
                    )
                  }
                  revising={revisingOpenArtifact}
                />
              ) : previewHtml !== null ? (
                <HtmlPreviewPanel
                  source={previewHtml}
                  isFull={previewFull}
                  onToggleFull={() => setPreviewFull((value) => !value)}
                  onClose={() => {
                    setPreviewHtml(null);
                    setPreviewFull(false);
                  }}
                />
              ) : null}
            </div>
          )}
        </main>
      </div>
      {isLanding && artifactFlow.openDetail ? (
        /* 落地态没有分栏槽位,全屏打开。必须在 main(isolate 堆叠上下文)之外,
           否则内部 z-40 压不过兄弟 header 的 z-20;也不能进带 transform 的 hero。 */
        <ArtifactCanvas
          detail={artifactFlow.openDetail}
          isFull
          onToggleFull={() => undefined}
          onClose={artifactFlow.closeCanvas}
          onSelectVersion={(version) =>
            void artifactFlow.openArtifactVersion(
              artifactFlow.openDetail!.artifact.id,
              version,
            )
          }
          onRevise={(instruction) =>
            void artifactFlow.revise(artifactFlow.openDetail!, instruction)
          }
          revising={revisingOpenArtifact}
        />
      ) : null}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {turn.announcement?.text ?? ''}
      </p>
      {artifactFlow.generation?.phase === 'confirm' ? (
        <ArtifactConfirmSheet
          kind={artifactFlow.generation.kind}
          defaultTitle={artifactFlow.generation.title}
          sourceCount={selectedAudioSources.length}
          onConfirm={(title) => {
            const openWhenReady = canvasSelected;
            setCanvasSelected(false);
            void artifactFlow.confirm(
              artifactFlow.generation!.kind,
              title,
              selectedAudioSources,
              { openWhenReady },
            );
          }}
          onClose={artifactFlow.dismiss}
        />
      ) : null}
      {studioOpen ? (
        <Sheet label="当前笔记本的 Studio" onClose={() => setStudioOpen(false)}>
          {studioItems.length === 0 ? (
            <p className="text-sm text-ink-muted">
              还没有产物。在输入框的「+」菜单里试试「生成思维导图」。
            </p>
          ) : (
            <ul className="space-y-2">
              {studioItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setStudioOpen(false);
                      void artifactFlow.openArtifact(item.id);
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface/70 p-3 text-left transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {item.title}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        {item.latestVersion > 0
                          ? `v${item.latestVersion}`
                          : item.status === 'proposed'
                            ? '生成中或未完成'
                            : item.status}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      ) : null}
      {assetPanel === 'assets' ? (
        <Sheet label="笔记本来源" onClose={() => setAssetPanel(null)}>
          <AssetsDrawer assets={notebookSources} onToggle={toggleAsset} />
        </Sheet>
      ) : null}
      {assetPanel === 'image' || assetPanel === 'document' ? (
        <Sheet
          label={assetPanel === 'image' ? '添加图片' : '添加 PDF'}
          onClose={() => setAssetPanel(null)}
        >
          <AssetUploadPanel
            kind={assetPanel}
            endpoint={ASSET_ENDPOINT}
            fixedScope="space"
            onUploaded={(asset) => {
              setAssets((current) => [
                { ...asset, enabled: asset.selectable },
                ...current.filter((item) => item.id !== asset.id),
              ]);
              setAssetPanel(null);
            }}
          />
        </Sheet>
      ) : null}
    </div>
  );
}
