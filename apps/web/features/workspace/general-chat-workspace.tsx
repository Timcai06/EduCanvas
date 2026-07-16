'use client';

import { startNewGeneralChatAction } from '@/app/actions';
import type { AssetItem } from '@/features/assets/assets-drawer';
import { AssetsDrawer } from '@/features/assets/assets-drawer';
import { loadAssets } from '@/features/assets/asset-client';
import { AssetUploadPanel } from '@/features/assets/asset-upload-panel';
import { HtmlPreviewPanel } from '@/features/canvas/html-preview-panel';
import { ChatPanel } from '@/features/chat/chat-panel';
import type { InitialChatMessageDTO } from '@/features/chat/messages';
import {
  useAgentTurn,
  type AgentTurnClientOptions,
} from '@/features/chat/use-teaching-turn';
import { Composer } from '@/features/composer/composer';
import type { PlusMenuActionId } from '@/features/composer/plus-menu';
import { useGSAP } from '@gsap/react';
import { Plus } from '@phosphor-icons/react';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AmbientHalo } from './ambient-halo';
import {
  PENDING_GENERAL_MENU_ACTION_KEY,
  PENDING_GENERAL_PROMPT_KEY,
} from './general-chat-entry';
import { HeroGreeting } from './hero-greeting';
import { LogoMark } from './logo-mark';
import { PromptSuggestions } from './prompt-suggestions';
import { Sheet } from './sheet';

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
];

export function GeneralChatWorkspace({
  initialMessages,
}: {
  initialMessages: readonly InitialChatMessageDTO[];
}) {
  const turn = useAgentTurn(initialMessages, GENERAL_TURN_OPTIONS);
  const [assets, setAssets] = useState<readonly AssetItem[]>([]);
  const [assetPanel, setAssetPanel] = useState<
    'assets' | AssetItem['kind'] | null
  >(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const haloWrapRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const flipStateRef = useRef<Flip.FlipState | null>(null);
  const nearBottom = useRef(true);
  const pendingConsumed = useRef(false);
  const pendingMenuConsumed = useRef(false);

  useEffect(() => {
    let active = true;
    void loadAssets(ASSET_ENDPOINT)
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
                usage: 'attachment' as const,
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
      });
    },
    [assets, turn],
  );

  useEffect(() => {
    if (pendingConsumed.current) return;
    pendingConsumed.current = true;
    const prompt = sessionStorage.getItem(PENDING_GENERAL_PROMPT_KEY);
    if (!prompt) return;
    sessionStorage.removeItem(PENDING_GENERAL_PROMPT_KEY);
    queueMicrotask(() => send(prompt));
  }, [send]);

  const handleMenuAction = useCallback((action: PlusMenuActionId) => {
    if (action === 'upload_file') setAssetPanel('document');
    else if (action === 'upload_image') setAssetPanel('image');
  }, []);

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

  const isLanding = turn.messages.length === 0;
  const selectedAssets = assets.filter((asset) => asset.enabled);

  /* 落地 → 对话:输入坞 Flip 位移,光场沉降为环境底光;reduced-motion 直接跳变。 */
  useGSAP(
    () => {
      const haloWrap = haloWrapRef.current;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        if (haloWrap) {
          gsap.to(haloWrap, {
            autoAlpha: isLanding ? 1 : 0.24,
            duration: 0.9,
            ease: 'power2.inOut',
          });
        }
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
        if (haloWrap) gsap.set(haloWrap, { autoAlpha: isLanding ? 1 : 0.24 });
      });
      return () => media.revert();
    },
    { scope: mainRef, dependencies: [isLanding] },
  );

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="z-20 flex h-16 shrink-0 items-center gap-3 px-4 sm:px-6">
        <span className="inline-flex items-center gap-2 font-display text-base font-semibold tracking-[-0.02em]">
          <span className="grid size-8 place-items-center rounded-full bg-accent-soft">
            <LogoMark size={17} />
          </span>
          EduCanvas
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setAssetPanel('assets')}
          className="hidden rounded-full px-4 py-2 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink sm:block"
        >
          资产
        </button>
        <form action={startNewGeneralChatAction}>
          <button
            type="submit"
            aria-label="新对话"
            title="新对话"
            className="grid size-10 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <Plus size={19} />
          </button>
        </form>
      </header>

      <main
        ref={mainRef}
        className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {/* 光场常驻:落地态满亮,对话态沉降为环境底光,避免转场时硬切。 */}
        <div
          ref={haloWrapRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          <AmbientHalo />
        </div>

        {isLanding ? (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center pb-14 text-center sm:pb-16">
            <HeroGreeting />
            <div ref={composerDockRef} className="w-full">
              <Composer
                chips={selectedAssets.map((asset) => ({
                  id: asset.id,
                  label: asset.label,
                }))}
                busy={turn.busy}
                statusText={turn.statusText ?? error}
                statusTone={error && !turn.busy ? 'error' : 'info'}
                onSend={send}
                onRemoveChip={toggleAsset}
                onMenuAction={handleMenuAction}
                availableMenuActions={GENERAL_MENU_ACTIONS}
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
                  node.scrollHeight - node.scrollTop - node.clientHeight <= 96;
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
            <div ref={composerDockRef} className="relative z-10">
              <Composer
                chips={selectedAssets.map((asset) => ({
                  id: asset.id,
                  label: asset.label,
                }))}
                busy={turn.busy}
                statusText={turn.statusText ?? error}
                statusTone={error && !turn.busy ? 'error' : 'info'}
                onSend={send}
                onRemoveChip={toggleAsset}
                onMenuAction={handleMenuAction}
                availableMenuActions={GENERAL_MENU_ACTIONS}
              />
            </div>
            </div>
            {previewHtml !== null ? (
              <HtmlPreviewPanel
                source={previewHtml}
                onClose={() => setPreviewHtml(null)}
              />
            ) : null}
          </div>
        )}
      </main>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {turn.announcement?.text ?? ''}
      </p>
      {assetPanel === 'assets' ? (
        <Sheet label="知识与媒体资产" onClose={() => setAssetPanel(null)}>
          <AssetsDrawer assets={assets} onToggle={toggleAsset} />
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
