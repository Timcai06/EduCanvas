'use client';

import { startNewGeneralChatAction } from '@/app/actions';
import type { AssetItem } from '@/features/assets/assets-drawer';
import { AssetsDrawer } from '@/features/assets/assets-drawer';
import { loadAssets } from '@/features/assets/asset-client';
import { AssetUploadPanel } from '@/features/assets/asset-upload-panel';
import { ChatPanel } from '@/features/chat/chat-panel';
import type { InitialChatMessageDTO } from '@/features/chat/messages';
import {
  useAgentTurn,
  type AgentTurnClientOptions,
} from '@/features/chat/use-teaching-turn';
import { Composer } from '@/features/composer/composer';
import type { PlusMenuActionId } from '@/features/composer/plus-menu';
import { Plus, Sparkle } from '@phosphor-icons/react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyChatHero } from './empty-chat-hero';
import {
  PENDING_GENERAL_MENU_ACTION_KEY,
  PENDING_GENERAL_PROMPT_KEY,
} from './general-chat-entry';
import { Sheet } from './sheet';

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
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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
  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="flex h-16 shrink-0 items-center gap-3 px-4 sm:px-6">
        <span className="inline-flex items-center gap-2 font-display text-base font-semibold tracking-[-0.02em]">
          <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-accent">
            <Sparkle size={16} weight="fill" />
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
        <Link
          href="/learn"
          className="rounded-full px-4 py-2 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          K12 学习模式
        </Link>
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

      {isLanding ? (
        <EmptyChatHero>
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
        </EmptyChatHero>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col">
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
              assistantLabel="AI"
            />
          </div>
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
        </main>
      )}

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
